const { Client } = require('pg');

async function main() {
  const connectionString = "postgresql://neondb_owner:npg_RNC6gJvOn1Yp@ep-hidden-sea-a5f97918.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  const companyId = '082b8e66-76af-4fed-9a69-db8d615893ed';
  const CORRECT_PHONE_NUMBER_ID = '1090528010807708';
  const NEW_PERMANENT_TOKEN = 'EAATgQyqKPScBRQYYIPdPHLTasVizp8HLKgWp9xpy38I8yjxz3YqpyrC95b8ZCt5IfvVjG66Hg1LwsRosMZAYgTItCcgSZCv6SWYOxTkgMRZBpWqIqZBjO4ZA2ZAs1PIiVhp8CyXd3gGSeSU1KY0QJSWe3hgoZAuGZC3DfLI5VOAj7IauSME4USsyKiV9MPJsFxoA3GQZDZD';

  try {
    await client.connect();
    console.log(`Connected to database. Searching for company ${companyId}...`);

    const res = await client.query('SELECT name, settings FROM "Company" WHERE id = $1', [companyId]);
    
    if (res.rows.length === 0) {
      console.error('Company not found!');
      return;
    }

    const company = res.rows[0];
    console.log(`Found company: ${company.name}. Updating settings...`);

    const currentSettings = company.settings || {};
    const updatedSettings = {
      ...currentSettings,
      whatsapp: {
        ...(currentSettings.whatsapp || {}),
        provider: 'meta',
        meta: {
          ...(currentSettings.whatsapp?.meta || {}),
          phoneNumberId: CORRECT_PHONE_NUMBER_ID,
          accessToken: NEW_PERMANENT_TOKEN,
          verifyToken: 'abc-investo'
        },
        phoneNumberId: CORRECT_PHONE_NUMBER_ID,
        accessToken: NEW_PERMANENT_TOKEN,
        verifyToken: 'abc-investo'
      }
    };

    await client.query('UPDATE "Company" SET settings = $1 WHERE id = $2', [JSON.stringify(updatedSettings), companyId]);

    console.log('Database updated successfully with pg client!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
