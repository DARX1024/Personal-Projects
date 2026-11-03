import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const bundle=(header,files,version,boot='')=>read(header)+'\n(function () {\n"use strict";\nconst VERSION = '+JSON.stringify(version)+';\n'+files.map(read).join('\n')+'\n'+boot+'\n})();\n';
const outputs={
 'AADB.user.js':bundle('src/aadb/metadata.txt',['constants','core','utils','battle','automation','data','ui','bootstrap'].map(n=>'src/aadb/'+n+'.js'),'3.8.0'),
 'HV-Interface.user.js':bundle('src/interface/metadata.txt',['src/interface/equipment.js','src/interface/translation.js','src/interface/runtime.js'],'1.0.0','startInterface();'),
 'HV-PonySolver.user.js':bundle('src/pony-metadata.txt',['src/pony.js'],'3.8.0','startPonySolver();')
};
for(const [name,content] of Object.entries(outputs)) {
 if(process.argv.includes('--check')) {if(!fs.existsSync(path.join(root,name))||read(name)!==content)throw new Error(name+' is out of date');}
 else fs.writeFileSync(path.join(root,name),content);
}
console.log(process.argv.includes('--check')?'Build outputs are current.':'Built 3 scripts; HV-Utils is maintained directly.');
