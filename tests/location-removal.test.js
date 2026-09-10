const test=require('node:test');
const assert=require('node:assert/strict');
const {planLocationRemoval,mapPositionAfterRemoval}=require('../src/location-removal');
const {setup}=require('./location-removal-harness');
const id='smartpasteblockID-0123456789abcdef',token='^'+id;
function apply(text,edit){if(!edit)return text;const offset=text.split('\n').slice(0,edit.from.line).reduce((n,line)=>n+line.length+1,0);return text.slice(0,offset+edit.from.ch)+text.slice(offset+edit.to.ch);}

const fixtures=[
 ['plain paragraph','Paragraph '+token,'Paragraph',0],
 ['Hebrew RTL','טקסט הפסקה '+token,'טקסט הפסקה',0],
 ['multiline paragraph','First\nשורה שנייה '+token,'First\nשורה שנייה',0],
 ['third-party comment','Text <!-- sidenotes: kept --> '+token,'Text <!-- sidenotes: kept -->',0],
 ['inline metadata and markers','Text key:: value #tag ⟦plugin⟧ '+token,'Text key:: value #tag ⟦plugin⟧',0],
 ['list','- Item '+token,'- Item',0],
 ['task','- [x] משימה '+token,'- [x] משימה',0],
 ['nested list','- First\n  - Nested '+token,'- First\n  - Nested',1],
 ['blockquote standalone','> Quote\n\n'+token,'> Quote\n\n',0],
 ['callout standalone','> [!note]\n> Body\n\n'+token,'> [!note]\n> Body\n\n',1],
 ['cursor on standalone ID','> Quote\n\n'+token,'> Quote\n\n',2],
 ['only target changes','Before ^user-id\n\nTarget '+token+'\n\nAfter ^aag-0123456789abcdef','Before ^user-id\n\nTarget\n\nAfter ^aag-0123456789abcdef',2],
 ['preserve multiple spaces','Text  '+token,'Text  ',0],
 ['preserve tab','Text\t'+token,'Text\t',0],
 ['preserve mixed whitespace','Text\t '+token,'Text\t ',0],
 ['preserve escaped space','Text\\ '+token,'Text\\ ',0],
 ['preserve blank lines','\n\nText '+token+'\n\n\nNext','\n\nText\n\n\nNext',2],
 ['preserve CRLF','First\r\nSecond '+token+'\r\n\r\nNext','First\r\nSecond\r\n\r\nNext',0],
 ['preserve paragraph hard break before standalone','Text  \n\n'+token+'\n\nNext','Text  \n\n\n\nNext',0]
];
for(const [name,doc,expected,line] of fixtures) test('minimal deletion: '+name,()=>{
 const edit=planLocationRemoval(doc,{line,ch:0});assert.ok(edit);assert.equal(edit.id,id);assert.equal(apply(doc,edit),expected);
 assert.equal(edit.from.line,edit.to.line);assert.equal(edit.text,'');
 assert.equal(planLocationRemoval(expected,{line,ch:0}),null,'repeated removal is harmless');
});

for(const [name,doc,line=0] of [
 ['no ID','Text'],['arbitrary native','Text ^user-id'],['third-party ID','Text ^sidenotes-0123456789abcdef'],
 ['legacy','Text ^aag-0123456789abcdef'],['legacy unknown','Text ^aag-user'],
 ['wrong length','Text ^smartpasteblockID-0123456789abcde'],['unknown suffix','Text ^smartpasteblockID-custom'],
 ['nonhex','Text ^smartpasteblockID-0123456789abcdeg'],['case variation','Text ^smartpasteblockID-0123456789abcdeF'],
 ['inline code','Text `'+token+'`'],['fenced code','```\n'+token+'\n```',1],
 ['HTML comment','<!-- '+token+' -->'],['open HTML comment','<!-- '+token],
 ['Obsidian comment','%% '+token+' %%'],['metadata frontmatter','---\nkey: '+token+'\n---',1],
 ['link reference','[ref]: '+token],['footnote','[^note]: '+token],
 ['multiple native anchors','Text '+token+'\n\n^other'],['duplicate ID','Text '+token+'\n\nOther '+token],
 ['cursor outside target','First\n\nTarget '+token],['escaped caret','Text \\'+token],
 ['code indentation','    '+token],['heading unsupported','## Heading '+token]
]) test('protected/no edit: '+name,()=>{assert.equal(planLocationRemoval(doc,{line,ch:0}),null);});

test('cursor mapping before/inside/after token and other lines',()=>{
 const edit=planLocationRemoval('Text '+token,{line:0,ch:0});
 for(const [p,want] of [[{line:0,ch:2},2],[{line:0,ch:6},4],[{line:0,ch:100},100-(edit.to.ch-edit.from.ch)]])assert.equal(mapPositionAfterRemoval(p,edit).ch,want);
 assert.deepEqual(mapPositionAfterRemoval({line:2,ch:10},edit),{line:2,ch:10});
});

for(const bundle of [false,true])test(`${bundle?'bundle':'source'}: confirmation then one atomic edit and verified save`,async()=>{
 const doc='טקסט '+token;const env=await setup(doc,{bundle,cursor:doc.length});
 assert.equal(env.command.name,'מחק נקודת הפניה של SmartPaste מהפסקה');
 await env.run(true,(env,modal)=>{
  assert.equal(env.editor.getValue(),doc);assert.equal(env.transactions.length,0);assert.equal(env.saves,0);
  assert.ok(modal.elements.some(el=>el.text?.includes('תבטל קישורים חיצוניים')));
  assert.equal(modal.elements.find(el=>el.tag==='button').focused,true,'cancel is default');
 });
 assert.equal(env.editor.getValue(),'טקסט');assert.equal(env.saved,'טקסט');assert.equal(env.saves,1);
 assert.equal(env.transactions.length,1);assert.equal(env.transactions[0].spec.changes.length,1);
 assert.equal(env.state.selection.main.empty,true);assert.equal(env.state.selection.main.head,4);
 await env.run();assert.equal(env.transactions.length,1);assert.equal(env.modals.length,1);
});

test('cancel and close leave every byte, cursor and saved content unchanged',async()=>{
 for(const close of [false,true]){
  const doc='Text '+token;const env=await setup(doc,{cursor:2});
  await env.run(false,(_env,modal)=>{if(close)modal.close();});
  assert.equal(env.saved,doc);assert.equal(env.editor.getValue(),doc);assert.equal(env.transactions.length,0);assert.equal(env.saves,0);assert.equal(env.state.selection.main.head,2);
 }
});

test('foreign, legacy and absent IDs have a notice, no confirmation or write',async()=>{
 for(const doc of ['Text','Text ^user-id','Text ^aag-0123456789abcdef']){
  const env=await setup(doc);await env.run();assert.equal(env.transactions.length,0);assert.equal(env.modals.length,0);assert.equal(env.notices.length,1);assert.equal(env.saved,doc);
 }
});

test('stale document, file, cursor, disk or unloaded plugin abort after confirmation',async()=>{
 for(const change of [env=>env.changeDoc('Changed '+token),env=>{env.view.file={...env.file};},env=>env.moveCursor(2),env=>{env.saved='external edit';},env=>env.unload()]){
  const env=await setup('Text '+token);await env.run(true,change);assert.equal(env.transactions.length,0);assert.equal(env.saves,0);
 }
});

test('unsaved text and normalized CRLF are protected before confirmation',async()=>{
 for(const [doc,saved] of [['Text '+token,'Old'],['First\nText '+token,'First\r\nText '+token]]){
  const env=await setup(doc,{saved});await env.run();assert.equal(env.modals.length,0);assert.equal(env.transactions.length,0);
 }
});

test('reentrant command opens only one confirmation and edits once',async()=>{
 const env=await setup('Text '+token);await env.run(true,async env=>{await env.command.callback();});
 assert.equal(env.modals.length,1);assert.equal(env.transactions.length,1);
});

test('save failure retains undoable minimal edit and reports failure',async()=>{
 const env=await setup('Text '+token,{saveFails:true});await env.run();assert.equal(env.transactions.length,1);assert.equal(env.saved,'Text '+token);assert.match(env.notices.at(-1),/השמירה נכשלה/);
});

test('an empty list/task keeps structural whitespace before its anchor',()=>{
 for(const prefix of ['- ','1. ','- [ ] ','- [x] ']){
  const doc=prefix+token;const edit=planLocationRemoval(doc,{line:0,ch:0});
  assert.ok(edit);assert.equal(apply(doc,edit),prefix);
 }
});

test('third-party edits during the transaction are not rewritten or reported as success',async()=>{
 const env=await setup('Text '+token,{onTransaction:env=>env.changeDoc('Text <!-- third-party change -->')});
 await env.run();assert.equal(env.transactions.length,1);assert.equal(env.saves,0);
 assert.equal(env.editor.getValue(),'Text <!-- third-party change -->');assert.match(env.notices.at(-1),/לא בוצעו תיקונים/);
});
