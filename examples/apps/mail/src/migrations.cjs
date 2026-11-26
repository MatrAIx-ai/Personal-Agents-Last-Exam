'use strict';
// App-owned data compatibility. Core validates the migrated state before use.
function migrateState(raw, target){
 if(raw.schema==='pale.app-state.v1'&&raw.package_version==='1.2.0'&&target.package_version==='1.3.0'&&raw.core_api_version===target.core_api_version)
  return {...raw,package_version:target.package_version};
 return raw;
}
module.exports={migrateState};
