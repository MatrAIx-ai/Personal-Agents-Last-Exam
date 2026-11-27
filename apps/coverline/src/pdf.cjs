'use strict';
// Original deterministic electronic PDF; built-in Helvetica, selectable ASCII text.
function render(title,lines){
 const clean=s=>String(s).replace(/[^\x20-\x7e]/g,' ').replace(/([\\()])/g,'\\$1');
 const wrapped=lines.flatMap(line=>{const text=String(line);if(!text)return [''];const out=[];let current='';for(const word of text.split(/\s+/)){if(current.length+word.length+1>88&&current){out.push(current);current='';}if(word.length>88){if(current){out.push(current);current='';}for(let i=0;i<word.length;i+=88)out.push(word.slice(i,i+88));}else current+=(current?' ':'')+word;}if(current)out.push(current);return out;});
 const pages=[];for(let i=0;i<wrapped.length;i+=43)pages.push(wrapped.slice(i,i+43));if(!pages.length)pages.push([]);
 const objects=['','<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const kids=[];
 for(const [index,rows]of pages.entries()){
  const page=objects.length,stream=page+1;kids.push(page+' 0 R');
  const content='0.12 0.16 0.23 rg\nBT /F1 19 Tf 48 742 Td ('+clean(title)+') Tj ET\nBT /F1 9 Tf 48 715 Td ('+clean('COVERLINE / ORIGINAL SYNTHETIC RECORD / PAGE '+(index+1))+') Tj ET\n0.25 0.30 0.36 rg\nBT /F1 10 Tf 48 684 Td 14 TL\n'+rows.map(s=>'('+clean(s)+') Tj T*').join('\n')+'\nET\nBT /F1 8 Tf 48 36 Td (Fictional provider. No policy purchase, binding or real payment.) Tj ET';
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+stream+' 0 R >>');
  objects.push('<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream');
 }
 objects[2]='<< /Type /Pages /Count '+kids.length+' /Kids ['+kids.join(' ')+'] >>';let out='%PDF-1.4\n',offsets=[0];
 for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=i+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=Buffer.byteLength(out);out+='xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(out);
}
module.exports={render};
