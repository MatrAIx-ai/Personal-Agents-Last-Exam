'use strict';
const C=require('./common.cjs'),id=C.path.basename(C.path.dirname(__dirname)),e=C.environment(id,__dirname),data=JSON.parse(C.fs.readFileSync(C.path.join(__dirname,'data.json'),'utf8'));
const report=C.coverage(e,data);if(process.argv.includes('--check'))C.assert.deepEqual(report,JSON.parse(C.fs.readFileSync(C.path.join(__dirname,'coverage.json'),'utf8')));else C.write(C.path.join(__dirname,'coverage.json'),report);
C.assert.equal(report.errors.length,0);C.assert.equal(report.missing_months.length,0);console.log(JSON.stringify({app:id,object_rows:report.object_rows,dated_facts:report.dated_fact_rows,global_distinct_dates:report.global_distinct_dates,earliest:report.earliest,latest:report.latest,missing_months:report.missing_months,errors:report.errors}));
