/**
 * watsonxClient.js
 *
 * Thin wrapper around the IBM watsonx.ai text generation REST API.
 * Handles IAM token exchange and request formatting for the
 * /ml/v1/text/generation endpoint.
 *
 * Falls back to stub mode when WATSONX_STUB=true or credentials are absent.
 */

'use strict';

const https    = require('https');
const http     = require('http');
const config   = require('../config');

let _cachedToken     = null;
let _tokenExpiry     = 0;
const IAM_TOKEN_URL  = 'https://iam.cloud.ibm.com/identity/token';
const TOKEN_LEEWAY   = 60 * 1000; // refresh 60s before expiry

// ---------------------------------------------------------------------------
// Public API: callWatsonx(prompt) → Promise<string>
// ---------------------------------------------------------------------------
async function callWatsonx(prompt) {
    if (config.stubMode || !config.watsonx.apiKey) {
        return `[STUB] ${prompt.split('\n')[0].substring(0, 80)}...`;
    }

    const token   = await getIamToken();
    const payload = {
        model_id:   config.watsonx.modelId,
        project_id: config.watsonx.projectId,
        input:      prompt,
        parameters: config.watsonx.parameters,
    };

    const responseBody = await postJson(
        config.watsonx.url + '/ml/v1/text/generation?version=2023-05-29',
        payload,
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    );

    const parsed = JSON.parse(responseBody);
    const result = parsed?.results?.[0]?.generated_text || '';
    return result.trim();
}

// ---------------------------------------------------------------------------
// IAM token exchange (cached)
// ---------------------------------------------------------------------------
async function getIamToken() {
    if (_cachedToken && Date.now() < _tokenExpiry - TOKEN_LEEWAY) {
        return _cachedToken;
    }

    const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(config.watsonx.apiKey)}`;
    const responseBody = await postRaw(IAM_TOKEN_URL, body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });

    const tokenData = JSON.parse(responseBody);
    _cachedToken = tokenData.access_token;
    _tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
    return _cachedToken;
}

// ---------------------------------------------------------------------------
// HTTP helpers (no external dependencies)
// ---------------------------------------------------------------------------
function postJson(url, data, headers) {
    const body = JSON.stringify(data);
    return postRaw(url, body, { ...headers, 'Content-Length': Buffer.byteLength(body) });
}

function postRaw(url, body, headers) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const lib       = parsedUrl.protocol === 'https:' ? https : http;
        const options   = {
            hostname: parsedUrl.hostname,
            port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path:     parsedUrl.pathname + parsedUrl.search,
            method:   'POST',
            headers,
        };

        const req = lib.request(options, (res) => {
            let chunks = '';
            res.on('data', d => chunks += d);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${chunks}`));
                } else {
                    resolve(chunks);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { callWatsonx };
