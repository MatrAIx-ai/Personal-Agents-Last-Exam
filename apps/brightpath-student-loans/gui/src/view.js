'use strict';
function render(state){return {title:'Brightpath Student Loans',summary:{loans:state.data.loans.length,applications:state.data.applications.length,notices:state.data.notices.length},warning:'Fictional policy and synthetic data; not financial advice.'};}
module.exports={render};
