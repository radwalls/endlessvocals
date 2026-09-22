'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let chromium;
try {
    ({ chromium } = require('playwright'));
} catch (error) {
    throw new Error(
        'Playwright is required. Set NODE_PATH to the bundled Node modules directory before running this test.',
        { cause: error }
    );
}

const SITE_ROOT = path.resolve(__dirname, '..');
const EXPECTED_PRESETS = Object.freeze({
    'frustrated-sigh': ['L'],
    'voice-grit': ['M'],
    fry: ['H'],
    'low-voice': ['L', 'M'],
    'voice-fry': ['M', 'H'],
    'low-fry': ['L', 'H'],
    'full-scream': ['L', 'M', 'H'],
});

const CONTENT_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
});

function startStaticServer() {
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        } catch (error) {
            response.writeHead(400).end('Bad request');
            return;
        }

        if (pathname === '/') pathname = '/scream-center.html';
        const requestedPath = path.resolve(SITE_ROOT, `.${pathname}`);
        if (requestedPath !== SITE_ROOT && !requestedPath.startsWith(`${SITE_ROOT}${path.sep}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        fs.readFile(requestedPath, (error, body) => {
            if (error) {
                response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
                return;
            }
            response.writeHead(200, {
                'cache-control': 'no-store',
                'content-type': CONTENT_TYPES[path.extname(requestedPath).toLowerCase()] || 'application/octet-stream',
            });
            response.end(body);
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                url: `http://127.0.0.1:${address.port}/scream-center.html`,
            });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function diagnostics(page) {
    return page.evaluate(() => window.__screamSynthDiagnostics());
}

async function waitForDiagnostics(page, predicateSource, description) {
    await page.waitForFunction(
        (source) => {
            const snapshot = window.__screamSynthDiagnostics?.();
            return snapshot && Function('snapshot', `return (${source})(snapshot);`)(snapshot);
        },
        predicateSource,
        { timeout: 5000 }
    ).catch((error) => {
        throw new Error(`Timed out waiting for ${description}`, { cause: error });
    });
}

async function assertRegisterSync(page, presetId, expectedRanks) {
    const snapshot = await diagnostics(page);
    assert.deepEqual(snapshot.activeRanks, expectedRanks, `${presetId || 'all-off'} engine ranks`);
    assert.equal(snapshot.selectedPreset, presetId, `${presetId || 'all-off'} selected preset`);

    const domState = await page.evaluate(() => ({
        pressedPresets: [...document.querySelectorAll('[data-scream-preset][aria-pressed="true"]')]
            .map((button) => button.dataset.screamPreset),
        pressedRanks: [...document.querySelectorAll('[data-rank-toggle][aria-pressed="true"]')]
            .map((button) => button.dataset.rank),
        litDots: [...document.querySelectorAll('[data-main-register-symbol] [data-rank].is-on')]
            .map((dot) => dot.dataset.rank),
        label: document.querySelector('[data-active-register]').textContent.trim(),
    }));

    assert.deepEqual(domState.pressedPresets, presetId ? [presetId] : []);
    assert.deepEqual(domState.pressedRanks, expectedRanks);
    assert.deepEqual(domState.litDots.sort(), [...expectedRanks].sort());
    if (!presetId) assert.match(domState.label, /silent/i);
}

async function run() {
    const { server, url } = await startStaticServer();
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--autoplay-policy=user-gesture-required', '--mute-audio'],
        });

        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });

        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        assert.equal(response.ok(), true, `page returned ${response.status()}`);
        await page.waitForFunction(() => typeof window.__screamSynthDiagnostics === 'function');

        assert.equal(await page.locator('[data-scream-preset]').count(), 7);
        assert.equal(await page.locator('[data-rank-toggle]').count(), 3);

        for (const [presetId, ranks] of Object.entries(EXPECTED_PRESETS)) {
            await page.locator(`[data-scream-preset="${presetId}"]`).click();
            await assertRegisterSync(page, presetId, ranks);

            const iconRanks = await page.locator(`[data-scream-preset="${presetId}"] [data-rank].is-on`)
                .evaluateAll((dots) => dots.map((dot) => dot.dataset.rank).sort());
            assert.deepEqual(iconRanks, [...ranks].sort(), `${presetId} register icon`);
        }

        for (const rank of ['L', 'M', 'H']) {
            await page.locator(`[data-rank-toggle][data-rank="${rank}"]`).click();
        }
        await assertRegisterSync(page, null, []);
        let snapshot = await diagnostics(page);
        assert.equal(snapshot.contextState, 'disabled');
        assert.equal(await page.locator('[data-scream-synth]').getAttribute('data-playing'), 'false');

        await page.locator('[data-scream-preset="full-scream"]').click();
        await page.locator('[data-pitch]').fill('64');
        await page.locator('[data-vowel]').selectOption('Oo');
        await page.locator('[data-grit]').fill('73');
        await page.locator('[data-expression]').fill('61');
        await page.locator('[data-layer-level="L"]').fill('21');
        await page.locator('[data-layer-level="M"]').fill('43');
        await page.locator('[data-layer-level="H"]').fill('65');

        await page.locator('[data-enable-audio]').click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.contextState === "running" && snapshot.pendingActions === 0', 'audio initialization');
        snapshot = await diagnostics(page);
        assert.equal(snapshot.contextCreateCount, 1);
        assert.ok(snapshot.sourceStartCount > 0);
        assert.equal(snapshot.analyserReady, true);
        const initialSourceCount = snapshot.sourceStartCount;

        await page.locator('[data-enable-audio]').click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.pendingActions === 0', 'second enable action');
        snapshot = await diagnostics(page);
        assert.equal(snapshot.contextCreateCount, 1);
        assert.equal(snapshot.sourceStartCount, initialSourceCount);

        await page.locator('[data-latch]').check();
        await page.locator('[data-hold-play]').click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.latched && snapshot.pendingActions === 0', 'latched playback');

        for (const presetId of ['fry', 'frustrated-sigh', 'voice-grit', 'low-fry', 'full-scream']) {
            await page.locator(`[data-scream-preset="${presetId}"]`).click();
            snapshot = await diagnostics(page);
            assert.equal(snapshot.pitchMidi, 64);
            assert.equal(snapshot.vowel, 'Oo');
            assert.equal(snapshot.grit, 0.73);
            assert.equal(snapshot.expression, 0.61);
            assert.equal(snapshot.contextCreateCount, 1);
            assert.equal(snapshot.sourceStartCount, initialSourceCount);
            assert.equal(snapshot.playing, true);
            assert.equal(await page.locator('[data-layer-level="L"]').inputValue(), '21');
            assert.equal(await page.locator('[data-layer-level="M"]').inputValue(), '43');
            assert.equal(await page.locator('[data-layer-level="H"]').inputValue(), '65');
        }

        await page.waitForTimeout(180);
        const outputSafety = await page.evaluate(() => {
            const snapshot = window.__screamSynthDiagnostics();
            const meterWidth = parseFloat(document.querySelector('[data-output-meter]').style.width || '0');
            const readout = document.querySelector('[data-meter-readout]').textContent.trim();
            return { snapshot, meterWidth, readout };
        });
        assert.ok(outputSafety.meterWidth >= 0 && outputSafety.meterWidth <= 100);
        assert.doesNotMatch(outputSafety.readout, /NaN|Infinity/i);
        assert.equal(Number.isFinite(outputSafety.snapshot.outputPeak), true);
        assert.equal(Number.isFinite(outputSafety.snapshot.outputRms), true);
        assert.equal(Number.isFinite(outputSafety.snapshot.outputCentroidHz), true);
        assert.ok(outputSafety.snapshot.outputPeak > 0 && outputSafety.snapshot.outputPeak < 0.97);
        assert.ok(outputSafety.snapshot.outputRms > 0);
        assert.ok(outputSafety.snapshot.outputCentroidHz > 0);
        assert.equal(outputSafety.snapshot.nonFiniteSampleCount, 0);
        assert.ok(outputSafety.snapshot.maxObservedPeak < 0.97);
        const meterSemantics = await page.locator('[data-output-meter-wrap]').evaluate((meter) => ({
            now: Number(meter.getAttribute('aria-valuenow')),
            text: meter.getAttribute('aria-valuetext'),
        }));
        assert.ok(meterSemantics.now > 0 && meterSemantics.now <= 1);
        assert.match(meterSemantics.text, /decibels peak/i);
        for (const value of Object.values(outputSafety.snapshot.layerTargetGains)) {
            assert.equal(Number.isFinite(value), true);
            assert.ok(value >= 0 && value <= 1);
        }

        for (const rank of ['L', 'M', 'H']) {
            await page.locator(`[data-rank-toggle][data-rank="${rank}"]`).click();
        }
        await assertRegisterSync(page, null, []);
        await page.waitForTimeout(180);
        snapshot = await diagnostics(page);
        assert.equal(snapshot.playing, true, 'all-off keeps the sustained gesture but must mute every layer');
        assert.deepEqual(snapshot.layerTargetGains, { L: 0, M: 0, H: 0 });
        assert.ok(snapshot.outputPeak < 0.0001);
        assert.ok(snapshot.outputRms < 0.0001);
        assert.equal(await page.locator('[data-scream-synth]').getAttribute('data-playing'), 'false');

        await page.locator('[data-stop-all]').click();
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && !snapshot.latched && snapshot.pendingActions === 0', 'STOP ALL SOUND');
        snapshot = await diagnostics(page);
        await page.waitForTimeout(100);
        snapshot = await diagnostics(page);
        assert.equal(await page.locator('[data-latch]').isChecked(), false);
        assert.ok(snapshot.outputPeak < 0.0001);
        assert.ok(snapshot.outputRms < 0.0001);
        assert.equal(snapshot.contextCreateCount, 1);
        assert.equal(snapshot.sourceStartCount, initialSourceCount);

        await page.locator('[data-scream-preset="voice-grit"]').click();
        const hold = page.locator('[data-hold-play]');
        await hold.scrollIntoViewIfNeeded();
        const box = await hold.boundingBox();
        assert.ok(box, 'Hold to Play must be visible');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.pendingActions === 0', 'held playback');
        await hold.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
        await page.mouse.up();
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && snapshot.pendingActions === 0', 'pointer cancellation');

        const firstKey = page.locator('[data-keyboard] [data-semitone="0"]');
        await firstKey.focus();
        await page.keyboard.down('Enter');
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.activeKeyboardKeyCount === 1', 'keyboard note start');
        await page.keyboard.up('Enter');
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && snapshot.activeKeyboardKeyCount === 0', 'keyboard note release');

        await hold.scrollIntoViewIfNeeded();
        const releaseBox = await hold.boundingBox();
        await page.mouse.move(releaseBox.x + releaseBox.width / 2, releaseBox.y + releaseBox.height / 2);
        await page.mouse.down();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing', 'normal hold start');
        await page.mouse.up();
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing', 'normal hold release');

        await page.locator('[data-latch]').check();
        await hold.click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.latched', 'second latch start');
        await page.locator('[data-latch]').uncheck();
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && !snapshot.latched', 'latch release');

        await page.locator('[data-latch]').check();
        await hold.click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.latched', 'blur setup');
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && !snapshot.latched && snapshot.activePointerCount === 0 && snapshot.activeKeyboardKeyCount === 0', 'focus-loss stop');

        await page.locator('[data-latch]').check();
        await hold.click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.latched', 'visibility setup');
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitForDiagnostics(page, '(snapshot) => !snapshot.playing && !snapshot.latched && snapshot.activePointerCount === 0 && snapshot.activeKeyboardKeyCount === 0', 'visibility stop');
        await page.evaluate(() => { delete document.hidden; });

        await page.locator('[data-layer-level="L"]').fill('72');
        await page.locator('[data-layer-level="M"]').fill('74');
        await page.locator('[data-layer-level="H"]').fill('62');
        await page.locator('[data-pitch]').fill('52');
        await page.locator('[data-latch]').check();
        await hold.click();
        await waitForDiagnostics(page, '(snapshot) => snapshot.playing && snapshot.latched', 'measurement playback');

        const combinationMeasurements = {};
        for (const presetId of Object.keys(EXPECTED_PRESETS)) {
            await page.locator(`[data-scream-preset="${presetId}"]`).click();
            await page.waitForTimeout(280);
            const measured = await diagnostics(page);
            assert.ok(measured.outputRms > 0.0005, `${presetId} produces measurable output`);
            assert.ok(measured.outputPeak > 0 && measured.outputPeak < 0.97, `${presetId} stays below the safety ceiling`);
            assert.equal(measured.nonFiniteSampleCount, 0);
            combinationMeasurements[presetId] = measured;
        }
        const soloMeasurements = ['frustrated-sigh', 'voice-grit', 'fry'].map((id) => combinationMeasurements[id]);
        const soloCentroids = soloMeasurements.map((item) => item.outputCentroidHz);
        assert.ok(Math.max(...soloCentroids) - Math.min(...soloCentroids) > 120, 'solo layers have measurably different spectra');

        await page.locator('[data-scream-preset="fry"]').click();
        const fryRmsReadings = [];
        for (let sample = 0; sample < 14; sample += 1) {
            await page.waitForTimeout(70);
            fryRmsReadings.push((await diagnostics(page)).outputRms);
        }
        const fryRmsFloor = Math.min(...fryRmsReadings);
        const fryRmsCeiling = Math.max(...fryRmsReadings);
        assert.ok(fryRmsFloor > 0.0005, 'default Fry stays continuously audible');
        assert.ok(fryRmsCeiling / fryRmsFloor < 1.35, 'default Fry remains a steady noise bed without heavy pulsing');

        await page.locator('[data-scream-preset="voice-grit"]').click();
        await page.locator('[data-grit]').fill('0');
        const vowelCentroids = [];
        for (const vowel of ['Ah', 'Ee', 'Oh', 'Oo']) {
            await page.locator('[data-vowel]').selectOption(vowel);
            await page.waitForTimeout(240);
            const measured = await diagnostics(page);
            assert.ok(measured.outputRms > 0.0005, `${vowel} remains audible with zero grit`);
            vowelCentroids.push(measured.outputCentroidHz);
        }
        assert.ok(Math.max(...vowelCentroids) - Math.min(...vowelCentroids) > 100, 'vowels create measurably different spectra');

        await page.locator('[data-vowel]').selectOption('Ah');
        await page.locator('[data-grit]').fill('0');
        await page.waitForTimeout(260);
        const cleanVoice = await diagnostics(page);
        await page.locator('[data-grit]').fill('100');
        await page.waitForTimeout(300);
        const grittyVoice = await diagnostics(page);
        const gritDifference = Math.abs(cleanVoice.outputCentroidHz - grittyVoice.outputCentroidHz)
            + Math.abs(cleanVoice.outputRms - grittyVoice.outputRms) * 10000;
        assert.ok(gritDifference > 30, 'grit measurably changes only the middle-layer patch');

        await page.evaluate(() => {
            const presets = [...document.querySelectorAll('[data-scream-preset]')];
            const pitch = document.querySelector('[data-pitch]');
            const grit = document.querySelector('[data-grit]');
            for (let index = 0; index < 112; index += 1) {
                presets[index % presets.length].click();
                pitch.value = String(36 + (index % 48));
                pitch.dispatchEvent(new Event('input', { bubbles: true }));
                grit.value = String(index % 101);
                grit.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.waitForTimeout(400);
        snapshot = await diagnostics(page);
        assert.equal(snapshot.contextCreateCount, 1);
        assert.equal(snapshot.sourceStartCount, initialSourceCount);
        assert.equal(snapshot.nonFiniteSampleCount, 0);
        assert.ok(snapshot.outputPeak >= 0 && snapshot.outputPeak < 0.97);

        await page.locator('[data-scream-preset="full-scream"]').click();
        for (const selector of ['[data-master]', '[data-expression]', '[data-layer-level="L"]', '[data-layer-level="M"]', '[data-layer-level="H"]', '[data-grit]']) {
            await page.locator(selector).fill('100');
        }
        for (const midi of ['36', '83']) {
            await page.locator('[data-pitch]').fill(midi);
            for (const vowel of ['Ah', 'Ee', 'Oh', 'Oo']) {
                await page.locator('[data-vowel]').selectOption(vowel);
                await page.waitForTimeout(100);
            }
        }
        await page.waitForTimeout(300);
        snapshot = await diagnostics(page);
        assert.equal(snapshot.nonFiniteSampleCount, 0);
        assert.ok(snapshot.maxObservedPeak < 0.97, `maximum observed peak ${snapshot.maxObservedPeak} stays below ceiling`);
        await page.locator('[data-stop-all]').click();

        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => typeof window.__screamSynthDiagnostics === 'function');
            const layout = await page.evaluate(() => {
                const instrument = document.querySelector('[data-scream-synth]').getBoundingClientRect();
                const keyboard = document.querySelector('[data-keyboard]');
                const key = keyboard.querySelector('.ss-key');
                const stop = document.querySelector('[data-stop-all]').getBoundingClientRect();
                return {
                    clientWidth: document.documentElement.clientWidth,
                    scrollWidth: document.documentElement.scrollWidth,
                    instrumentLeft: instrument.left,
                    instrumentRight: instrument.right,
                    keyboardClientWidth: keyboard.clientWidth,
                    keyboardScrollWidth: keyboard.scrollWidth,
                    keyHeight: key.getBoundingClientRect().height,
                    keyTouchAction: getComputedStyle(key).touchAction,
                    stopHeight: stop.height,
                };
            });
            assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${viewport.width}px viewport has horizontal overflow`);
            assert.ok(layout.instrumentLeft >= -1, `${viewport.width}px instrument extends left`);
            assert.ok(layout.instrumentRight <= layout.clientWidth + 1, `${viewport.width}px instrument extends right`);
            assert.ok(layout.keyHeight >= 44, `${viewport.width}px keys remain touch-sized`);
            assert.ok(layout.stopHeight >= 44, `${viewport.width}px STOP remains touch-sized`);
            if (layout.keyboardScrollWidth > layout.keyboardClientWidth) {
                assert.match(layout.keyTouchAction, /pan-x|auto/, 'overflowing keyboard permits horizontal touch scrolling');
            }
            assert.equal(await page.locator('[data-stop-all]').isVisible(), true);
        }

        assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`);
        assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('\n')}`);

        await context.close();
        console.log('Scream Synth browser verification passed.');
    } finally {
        if (browser) await browser.close();
        await closeServer(server);
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
