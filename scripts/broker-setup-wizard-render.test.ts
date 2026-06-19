import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

async function renderWizard(extraProps: Record<string, unknown>) {
    const server = await createServer({
        configFile: 'vite.config.ts',
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error',
    });

    try {
        const mod = (await server.ssrLoadModule(
            '/src/components/broker-setup-wizard.tsx',
        )) as {
            BrokerSetupWizard: React.ComponentType<Record<string, unknown>>;
        };

        return renderToStaticMarkup(
            React.createElement(mod.BrokerSetupWizard, {
                open: true,
                initialBroker: 'fubon',
                configured: { fubon: true, nova: false, esun: false },
                currentBroker: 'mock',
                onClose: () => {},
                ...extraProps,
            }),
        );
    } finally {
        await server.close();
    }
}

test('BrokerSetupWizard renders an initial error when opened after saved-login failure', async () => {
    const message =
        '已儲存的登入資訊無法使用，請重新設定：keychain locked';

    const html = await renderWizard({ initialError: message });

    assert.match(html, new RegExp(message));
});

test('BrokerSetupWizard renders esun config import instead of manual key fields', async () => {
    const html = await renderWizard({ initialBroker: 'esun' });

    assert.match(html, /匯入玉山設定檔/);
    assert.match(html, /登入密碼/);
    assert.match(html, /憑證密碼/);
    assert.doesNotMatch(html, /API Key/);
    assert.doesNotMatch(html, /API Secret/);
});
