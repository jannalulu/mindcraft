import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class Hyperbolic {
    constructor(model_name, url) {
        if (!model_name?.startsWith('hyperbolic/')) {
            throw new Error('Hyperbolic model names must start with "hyperbolic/"');
        }
        
        this.model_name = model_name.replace('hyperbolic/', '');
        this.url = url || 'https://api.hyperbolic.xyz/v1';
        this.apiKey = getKey('HYPERBOLIC_API_KEY');
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000;
    }

    async checkRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    async sendRequest(turns, systemMessage) {
        await this.checkRateLimit();
        
        let messages = strictFormat(turns);
        if (systemMessage) {
            messages.unshift({role: 'system', content: systemMessage});
        }

        let res = null;
        let retries = 3;
        
        while (retries > 0) {
            try {
                console.log('Sending request to Hyperbolic API (' + retries + ' retries left)...');
                
                // Format the messages into a single prompt string
                let prompt = '';
                for (const msg of messages) {
                    if (msg.role === 'system') {
                        prompt += `System: ${msg.content}\n\n`;
                    } else if (msg.role === 'user') {
                        prompt += `Human: ${msg.content}\n`;
                    } else if (msg.role === 'assistant') {
                        prompt += `Assistant: ${msg.content}\n`;
                    }
                }
                prompt += 'Assistant:'; // Add the expected assistant response prefix

                const requestBody = {
                    prompt: prompt,
                    model: this.model_name,
                    temperature: 0.7,
                    max_tokens: 1024,
                    stream: false
                };

                console.log('Request payload:', JSON.stringify(requestBody, null, 2));

                const response = await fetch(`${this.url}/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (response.status === 429) {
                    retries--;
                    console.log(`Rate limited. Retries left: ${retries}`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error(`Response status: ${response.status}`);
                    console.error('Error details:', errorBody);
                    throw new Error(`Hyperbolic API error: ${response.status} - ${errorBody}`);
                }

                const data = await response.json();
                res = data.choices[0].text.trim();
                console.log('Received response:', data);
                break;
            } catch (err) {
                if (retries > 1 && err.message.includes('429')) {
                    retries--;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                console.error('Error details:', err);
                res = 'My brain disconnected, try again.';
                break;
            }
        }
        return res;
    }

    async embed(text) {
        await this.checkRateLimit();
        
        try {
            const response = await fetch(`${this.url}/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    input: text,
                    model: "text-embedding-3-small"
                })
            });

            if (response.status === 429) {
                console.log('Rate limited on embeddings, falling back to word overlap.');
                return null;
            }

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Hyperbolic API error ${response.status}:`, errorBody);
                throw new Error(`Hyperbolic API error: ${response.status}\nDetails: ${errorBody}`);
            }

            const data = await response.json();
            return data.data[0].embedding;
        } catch (err) {
            console.error('Embedding error details:', err);
            console.log('Error getting embeddings from Hyperbolic, falling back to word overlap.');
            return null;
        }
    }
}