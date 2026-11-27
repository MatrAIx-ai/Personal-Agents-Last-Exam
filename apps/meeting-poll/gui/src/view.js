'use strict';
// Legacy reviewer renderer, not the interactive Agent GUI. Receives authorized records only.
function render(data){return JSON.stringify(data,null,2);}
module.exports={render};
