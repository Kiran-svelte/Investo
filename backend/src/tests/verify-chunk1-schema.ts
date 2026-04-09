import db from '../../src/config/database';

async function verifySchema() {
  try {
    const result = await db.raw(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'properties'
      ORDER BY ordinal_position
    `);
    
    console.log('=== Properties Table Columns ===');
    result.rows.forEach((row: { column_name: string; data_type: string }) => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });
    
    const newCols = ['floor_plan_urls', 'price_list_url', 'latitude', 'longitude'];
    const existingCols = result.rows.map((r: { column_name: string }) => r.column_name);
    
    console.log('\n=== CHUNK 1 New Columns Check ===');
    newCols.forEach(col => {
      const exists = existingCols.includes(col);
      console.log(`  ${col}: ${exists ? '✅ EXISTS' : '❌ MISSING'}`);
    });
    
    const allExist = newCols.every(col => existingCols.includes(col));
    console.log(`\n${allExist ? '✅ ALL NEW COLUMNS PRESENT' : '❌ SOME COLUMNS MISSING'}`);
    
    return allExist;
  } finally {
    await db.destroy();
  }
}

verifySchema().then(success => {
  process.exit(success ? 0 : 1);
});
