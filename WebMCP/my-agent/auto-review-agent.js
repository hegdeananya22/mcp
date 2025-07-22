import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import { OpenAI } from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
const repoURL = 'https://github.com/rinadelph/Agent-MCP';

async function extractLicenseAndReadme() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(repoURL, { waitUntil: 'domcontentloaded' });

  console.log('✅ Opened GitHub repo:', repoURL);

  // Step 1: Extract README
  let readme = '';
  try {
    const readmeElement = await page.waitForSelector('#readme, .markdown-body', { timeout: 12000 });
    readme = await readmeElement.evaluate(el => el.innerText);
    console.log('📘 README found.');
  } catch {
    console.log('⚠️ No README.md found.');
  }

  // Step 2: Extract LICENSE
  let licenseText = '';
  let licenseType = 'Unknown';
  const licenseHref = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    const match = links.find(link =>
      /license/i.test(link.textContent.trim())
    );
    return match ? match.href : null;
  });

  if (licenseHref) {
    await page.goto(licenseHref);
    try {
      const licenseBlock = await page.waitForSelector('article.markdown-body, pre', { timeout: 10000 });
      licenseText = await licenseBlock.evaluate(el => el.innerText);
      if (licenseText.includes('MIT')) licenseType = 'MIT';
      else if (licenseText.includes('Apache')) licenseType = 'Apache 2.0';
      else if (licenseText.includes('GNU')) licenseType = 'GPL';
      console.log('📄 LICENSE detected:', licenseType);
    } catch {
      console.log('⚠️ LICENSE content could not be loaded.');
    }
  } else {
    console.log('❗ No LICENSE file found.');
  }

  // Step 3: Code files listing
  await page.goto(repoURL);
  const fileNames = await page.$$eval('div[role="rowheader"] span[title]', els =>
    els.map(el => el.textContent.trim())
  );
  const codeFiles = fileNames.filter(name =>
    name.endsWith('.py') || name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.ipynb')
  );
  console.log('📂 Code files found:', codeFiles);

  // Step 4: Summarize README
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
      console.log('\n🧠 Project Summary:\n', summary);
    } catch (err) {
      console.error('❌ OpenAI Summary Error:', err.message);
    }
  }

  if (licenseType === 'Unknown' && codeFiles.length > 0) {
    console.log('\n⚠️ Potential Issue: Code present but no license. May pose legal risk!');
  }

  // Optional: Save report
  const report = `
# 🧾 GitHub Repo Audit

**Repo:** ${repoURL}

## 📘 README Summary:
${summary || 'No README or failed to summarize.'}

## 📄 License:
- Type: ${licenseType}
- Detected Text:
\\\
${licenseText.slice(0, 300)}...
\\\

## 📂 Code Files:
${codeFiles.map(f => `- ${f}`).join('\n')}

---

Generated on: ${new Date().toLocaleString()}
`;

  fs.writeFileSync('audit-report.md', report);
  console.log('\n✅ Report saved to audit-report.md');

  await browser.close();
}

extractLicenseAndReadme();
