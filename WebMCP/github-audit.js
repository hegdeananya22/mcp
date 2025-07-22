import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// Listen to stdin (required by MCP)
process.stdin.on('data', async (data) => {
  const input = JSON.parse(data.toString().trim());
  const repoURL = input.repo || 'https://github.com/rinadelph/Agent-MCP';

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(repoURL, { waitUntil: 'domcontentloaded' });

  let readme = '';
  try {
    const readmeElement = await page.waitForSelector('#readme, .markdown-body', { timeout: 8000 });
    readme = await readmeElement.evaluate(el => el.innerText);
  } catch {}

  let licenseText = '';
  let licenseType = 'Unknown';
  const licenseHref = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    const match = links.find(link => /license/i.test(link.textContent.trim()));
    return match ? match.href : null;
  });

  if (licenseHref) {
    await page.goto(licenseHref);
    try {
      const licenseBlock = await page.waitForSelector('article.markdown-body, pre', { timeout: 8000 });
      licenseText = await licenseBlock.evaluate(el => el.innerText);
      if (licenseText.includes('MIT')) licenseType = 'MIT';
      else if (licenseText.includes('Apache')) licenseType = 'Apache 2.0';
      else if (licenseText.includes('GNU')) licenseType = 'GPL';
    } catch {}
  }

  const fileNames = await page.$$eval('div[role="rowheader"] span[title]', els =>
    els.map(el => el.textContent.trim())
  );
  const codeFiles = fileNames.filter(name =>
    name.endsWith('.py') || name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.ipynb')
  );

  let summary = '';
  if (readme.length > 30) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'Summarize the following GitHub project README in 3 bullet points:' },
          { role: 'user', content: readme },
        ],
        temperature: 0,
      });
      summary = response.choices[0].message.content;
    } catch {}
  }

  await browser.close();

  const output = {
    summary,
    licenseType,
    licenseText: licenseText.slice(0, 300),
    codeFiles,
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
