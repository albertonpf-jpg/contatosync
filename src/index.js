async function discoverICloudAddressBook(appleId, appPassword) {
    debugLog('=== INICIANDO DESCOBERTA ADDRESSBOOK ICLOUD ===');

    // Tentar múltiplos endpoints (hotmail/outlook usam endpoint diferente às vezes)
    const endpoints = [
        'https://contacts.icloud.com/',
        'https://p01-contacts.icloud.com/',
        'https://p02-contacts.icloud.com/',
        'https://p03-contacts.icloud.com/',
    ];

    for (const endpoint of endpoints) {
        try {
            debugLog('Tentando endpoint: ' + endpoint);
            const principalResp = await axios({
                method: 'PROPFIND',
                url: endpoint,
                auth: { username: appleId, password: appPassword },
                headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
                data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>',
                timeout: 10000,
                validateStatus: (s) => s < 600,
                maxRedirects: 5
            });

            debugLog('Endpoint ' + endpoint + ' status: ' + principalResp.status);
            const rawData = String(principalResp.data);
            debugLog('Resposta: ' + rawData.substring(0, 800));

            if (principalResp.status === 401) continue; // credencial errada neste endpoint
            if (principalResp.status >= 400) continue;

            // Extrair qualquer ID numérico longo da resposta
            const numericMatch = rawData.match(/\/(\d{6,})\//);
            if (numericMatch) {
                const numericId = numericMatch[1];
                // Determinar base do endpoint
                const base = endpoint.replace(/\/$/, '');
                const addressBookUrl = base + '/' + numericId + '/carddavhome/card/';
                debugLog('ID numérico encontrado: ' + numericId + ' → ' + addressBookUrl);

                // Testar se funciona
                const testResp = await axios({
                    method: 'PROPFIND',
                    url: addressBookUrl,
                    auth: { username: appleId, password: appPassword },
                    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
                    data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
                    timeout: 10000,
                    validateStatus: () => true
                });
                debugLog('Teste addressBookUrl status: ' + testResp.status);

                if (testResp.status < 400) {
                    debugLog('✅ URL válida: ' + addressBookUrl);
                    return addressBookUrl;
                }
            }

            // Tentar via href do principal
            const principalMatch = rawData.match(/<[^>]*:?href[^>]*>\s*([^<]+)\s*<\/[^>]*:?href>/i);
            if (principalMatch) {
                let principalHref = principalMatch[1].trim();
                debugLog('Principal href: ' + principalHref);

                const homeUrl = principalHref.startsWith('http') ? principalHref : endpoint.replace(/\/$/, '') + principalHref;

                const homeSetResp = await axios({
                    method: 'PROPFIND',
                    url: homeUrl,
                    auth: { username: appleId, password: appPassword },
                    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
                    data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><C:addressbook-home-set/></D:prop></D:propfind>',
                    timeout: 10000,
                    validateStatus: (s) => s < 600
                });

                debugLog('Home-set status: ' + homeSetResp.status);
                debugLog('Home-set data: ' + String(homeSetResp.data).substring(0, 500));

                const homeMatch = String(homeSetResp.data).match(/addressbook-home-set[\s\S]*?<[^>]*:?href[^>]*>\s*([^<]+)\s*<\/[^>]*:?href>/i);
                if (homeMatch) {
                    let homeHref = homeMatch[1].trim();
                    if (!homeHref.startsWith('http')) homeHref = endpoint.replace(/\/$/, '') + homeHref;
                    if (!homeHref.endsWith('/')) homeHref += '/';
                    debugLog('addressbook-home-set: ' + homeHref);

                    // Testar
                    const testResp2 = await axios({
                        method: 'PROPFIND',
                        url: homeHref,
                        auth: { username: appleId, password: appPassword },
                        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
                        data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
                        timeout: 10000,
                        validateStatus: () => true
                    });
                    debugLog('Teste home-set status: ' + testResp2.status);

                    if (testResp2.status < 400) {
                        debugLog('✅ URL válida via home-set: ' + homeHref);
                        return homeHref;
                    }
                }
            }
        } catch (e) {
            debugLog('Erro no endpoint ' + endpoint + ': ' + e.message);
        }
    }

    // Último fallback — logar claramente que falhou tudo
    debugLog('❌ Todos os endpoints falharam. Conta @hotmail pode precisar de Apple ID alternativo (@icloud.com)');
    throw new Error('Não foi possível descobrir o addressbook do iCloud. Tente usar o Apple ID com @icloud.com ou @me.com em vez de @hotmail.com');
}
