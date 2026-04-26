// No need for node-fetch in Node 18+
const url = 'https://api.render.com/v1/services/srv-d79itik50q8c73fjqi7g';
const headers = {
    'Authorization': 'Bearer rnd_GjjVdNl0zMCbmHhBKHPlXwyqLik4',
    'Content-Type': 'application/json'
};

const buildCommand = 'npm install --include=dev && npx prisma generate && npm run build';

fetch(url, {
    method: 'PATCH',
    headers: headers,
    body: JSON.stringify({
        serviceDetails: {
            envSpecificDetails: {
                buildCommand: buildCommand
            }
        }
    })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
