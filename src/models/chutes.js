import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class Chutes {
    static prefix = 'chutes';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.url = url || 'https://api.chutes.ai';
        this.params = params || {};

        try {
            this.apiKey = getKey('CHUTES_API_KEY');
        } catch (err) {
            console.error('CHUTES_API_KEY not found in keys.json or environment variables.');
            this.apiKey = null;
        }
    }

    async sendRequest(turns, systemMessage) {
        const model = this.model_name || 'Qwen/Qwen3-32B';
        let messages = strictFormat(turns || []);
        messages.unshift({ role: 'system', content: systemMessage });
        const body = { model, messages, ...this.params };

        // Build a set of model-name variants to try (original, last segment, lowercase, hyphenated)
        const candidates = new Set();
        candidates.add(model);
        if (model.includes('/')) {
            const parts = model.split('/');
            candidates.add(parts[parts.length - 1]);
        }
        if (model.includes(':')) {
            const parts = model.split(':');
            candidates.add(parts[parts.length - 1]);
        }
        candidates.add(model.replace(/\//g, '-'));
        candidates.add(model.toLowerCase());
        // also try removing non-alphanumerics except - and _
        candidates.add(model.replace(/[^A-Za-z0-9-_]/g, ''));

        const modelVariants = Array.from(candidates).filter(Boolean);

        const pathsToTry = [
            '/v1/chat/completions',
            '/v1/completions'
        ];

        for (const m of modelVariants) {
            pathsToTry.push(`/v1/models/${encodeURIComponent(m)}/chat`);
            pathsToTry.push(`/v1/chutes/${encodeURIComponent(m)}/completions`);
            pathsToTry.push(`/v1/chutes/${encodeURIComponent(m)}/chat`);
        }

        // Try each constructed path until one succeeds.
        for (const path of pathsToTry) {
            const endpoint = new URL(path, this.url).toString();
            try {
                console.log('Chutes: trying endpoint', endpoint);
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
                    },
                    body: JSON.stringify(body)
                });

                const text = await res.text().catch(() => '');
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

                if (!res.ok) {
                    console.warn('Chutes endpoint', endpoint, 'failed', res.status, text);
                    // If we get 429, surface that as a useful hint and stop trying further variants
                    if (res.status === 429) {
                        console.error('Chutes rate limit encountered on', endpoint);
                        return 'The Chutes model is currently rate-limited. Try again later or use a different model.';
                    }
                    continue;
                }

                const choice = data?.choices?.[0] || null;
                if (choice) {
                    if (choice.message?.content) return choice.message.content;
                    if (choice.content) return choice.content;
                }
                if (data?.output_text) return data.output_text;
                if (typeof data === 'string' && data.length) return data;

                console.warn('Chutes returned no content for endpoint', endpoint, data);
                return 'No response received.';
            } catch (err) {
                console.warn('Chutes endpoint error', path, err?.message || err);
            }
        }

        console.error('All Chutes endpoints and model variants failed.');
        return 'My brain disconnected, try again.';
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: 'user',
            content: [
                { type: 'text', text: systemMessage },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` }
                }
            ]
        });
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        throw new Error('Embeddings not implemented for Chutes adapter.');
    }
}
