const puppeteer = require('puppeteer-core');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const PNG = require('pngjs').PNG;
const { promisify } = require('util');
const axios = require('axios');
const readline = require('readline');
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Hardcoded viewport dimensions
const VIEWPORT_WIDTH = 1400;  // Set your desired width
const VIEWPORT_HEIGHT = 800;  // Set your desired height

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function scrollToBottomAndBack(page) {
    await page.evaluate(async () => {
        const distance = 100; // Distance to scroll each time
        const scrollDelay = 100; // Delay between scrolls (in milliseconds)

        function scrollToBottom() {
            return new Promise(resolve => {
                const scrollHeight = document.documentElement.scrollHeight;
                const currentPosition = window.scrollY + window.innerHeight;

                if (currentPosition < scrollHeight) {
                    window.scrollBy(0, distance);
                    setTimeout(() => resolve(scrollToBottom()), scrollDelay);
                } else {
                    resolve();
                }
            });
        }

        function scrollToTop() {
            return new Promise(resolve => {
                const scrollTop = window.scrollY;

                if (scrollTop > 0) {
                    window.scrollBy(0, -distance);
                    setTimeout(() => resolve(scrollToTop()), scrollDelay);
                } else {
                    resolve();
                }
            });
        }
        // delay(60000);
        await scrollToBottom();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit at the bottom
        await scrollToTop();
    });
}

async function generateScreenshot(url, screenshotPath) {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true
    });

    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    await page.goto(url, { waitUntil: 'networkidle0',timeout: 0  });

    // Click the cookie button if it exists
    try {
        await page.waitForSelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { visible: true });
        await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
        console.log('Clicked cookie consent button.');
    } catch (error) {
        console.log('Cookie consent button not found or not visible.');
    }

    await scrollToBottomAndBack(page);

    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();
}

async function convertPngToPdf(pngPath, pdfPath) {
    const pngData = await readFile(pngPath);
    const png = PNG.sync.read(pngData);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([png.width, png.height]);

    const pngImage = await pdfDoc.embedPng(pngData);
    page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: png.width,
        height: png.height,
    });

    const pdfBytes = await pdfDoc.save();
    await writeFile(pdfPath, pdfBytes);
}

async function createZipFile(files, zipFileName) {
    const output = fs.createWriteStream(zipFileName);
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', function() {
        console.log(`ZIP file ${zipFileName} created, ${archive.pointer()} total bytes`);
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.pipe(output);

    files.forEach(file => {
        archive.file(file, { name: path.basename(file) });
    });

    await archive.finalize();
}

async function exportWebsitesToZip(urls, outputZip) {
    const pdfFiles = [];

    for (const url of urls) {
        const screenshotPath = path.join(__dirname, 'debug.png');
        const pdfFileName = path.basename(url).replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
        const pdfPath = path.join(__dirname, pdfFileName);
        pdfFiles.push(pdfPath);

        console.log(`Generating screenshot for: ${url}`);
        await generateScreenshot(url, screenshotPath);

        console.log(`Converting screenshot to PDF for: ${url}`);
        await convertPngToPdf(screenshotPath, pdfPath);

        // Optionally delete the PNG file after conversion
        fs.unlinkSync(screenshotPath);
    }

    console.log('Creating ZIP file...');
    await createZipFile(pdfFiles, outputZip);

    // Clean up PDF files
    pdfFiles.forEach(file => fs.unlinkSync(file));
}

async function getUrlsFromApi(userUrl) {
    const apiUrl = `${userUrl}/api/pages?pagination[page]=1&pagination[pageSize]=100`;
    try {
        const response = await axios.get(apiUrl);
        const data = response.data;

        const frontUrl = userUrl.replace("-api", "");


        // Manipulate URLs
        const urls = data.data.map(x => `${frontUrl}${x.attributes.slug}`);
        const urlsClean = urls.map(x => x.replace('/null', ''));
        return urlsClean;
    } catch (error) {
        console.error('Error fetching data from API:', error);
        return [];
    }
}

async function promptUserForUrl() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Please enter the base URL: ', (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function main() {
    const userUrl = await promptUserForUrl();
    const urlsClean = await getUrlsFromApi(userUrl);

    if (urlsClean.length > 0) {
        console.log('Starting export...');
        await exportWebsitesToZip(urlsClean, 'websites.zip');
        console.log('Export completed.');
    } else {
        console.log('No valid URLs found.');
    }
}

main();
