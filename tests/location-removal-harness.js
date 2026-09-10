const fs = require('node:fs');
const vm = require('node:vm');
const { EditorState } = require('@codemirror/state');

function loadRemovalCommand(obsidian) {
  const context = { module: {exports:{}}, require(name) {
    if(name==='obsidian') return obsidian;
    if(name==='./editor-command') return require('./editor-command-harness').loadEditorCommand(obsidian);
    if(name==='./location-removal') return require('../src/location-removal');
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/remove-location-command'),'utf8'),context);
  return context.module.exports;
}

async function setup(doc, options={}) {
  const commands=[],notices=[],cleanups=[],transactions=[],modals=[];
  let state=EditorState.create({doc,selection:{anchor:options.cursor||0}}), saved=options.saved??doc, saves=0;
  class MarkdownView { getMode() { return "source"; } }
  class Modal {
    constructor() { this.elements=[];this.closed=false;this.contentEl={
      createEl:(tag,attrs)=>{const el={tag,...attrs,addEventListener:(event,fn)=>el[event]=fn,focus:()=>el.focused=true};this.elements.push(el);return el;},
      empty:()=>{}
    }; }
    open() { modals.push(this);this.onOpen(); }
    close() { if(!this.closed){this.closed=true;this.onClose();} }
    click(confirm) {this.elements.filter(el=>el.tag==='button')[confirm?1:0].click();}
  }
  class Plugin {
    addCommand(command){commands.push(command);}
    register(fn){cleanups.push(fn);}
    registerEditorExtension(){}
    registerObsidianProtocolHandler(){}
  }
  const obsidian={Modal,MarkdownView,Plugin,Notice:class{constructor(s){notices.push(s);}}};
  const editor={getValue:()=>state.doc.toString(),getCursor:()=>pos(state.selection.main.head),
    listSelections:()=>state.selection.ranges.map(r=>({anchor:pos(r.anchor),head:pos(r.head)})),
    transaction(spec,origin){
      transactions.push({spec,origin});
      const changes=spec.changes.map(c=>({from:offset(c.from),to:offset(c.to),insert:c.text}));
      const changed=state.update({changes}).state;
      const offsetAfter=p=>changed.doc.line(p.line+1).from+p.ch;
      state=state.update({changes,selection:{anchor:offsetAfter(spec.selections[0].from),head:offsetAfter(spec.selections[0].to)}}).state;
      options.onTransaction?.(env);
    }
  };
  function pos(n){const line=state.doc.lineAt(n);return {line:line.number-1,ch:n-line.from};}
  function offset(p){return state.doc.line(p.line+1).from+p.ch;}
  const file={path:'תיקייה/פתק.md',extension:'md'};
  const view=Object.assign(new MarkdownView(),{file,editor,async save(){saves++;if(options.saveFails)throw Error('save failed');saved=editor.getValue();}});
  const app={vault:{async read(){return saved;}},workspace:{getActiveViewOfType:()=>view,getMostRecentLeaf:()=>null,onLayoutReady:fn=>fn()}};
  let plugin;
  if(options.bundle) {
    const context={module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name)};
    vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'),'utf8'),context);
    plugin=new context.module.exports();plugin.app=app;await plugin.onload();
  } else {plugin=new Plugin();plugin.app=app;loadRemovalCommand(obsidian).registerLocationRemoval(plugin);}
  const command=commands.find(c=>c.id==='remove-smartpaste-location-point');
  const env={commands,command,notices,transactions,modals,editor,view,file,plugin,app,
    get state(){return state;},get saved(){return saved;},set saved(v){saved=v;},get saves(){return saves;},
    unload(){cleanups.forEach(fn=>fn());},
    changeDoc(doc){state=EditorState.create({doc});},
    moveCursor(n){state=state.update({selection:{anchor:n}}).state;},
    async run(confirm=true,whileOpen){
      const promise=command.callback();
      await new Promise(setImmediate);
      const modal=modals.at(-1);
      if(modal&&!modal.closed){await whileOpen?.(env,modal);modal.click(confirm);}
      await promise;
    }
  };
  return env;
}
module.exports={setup,loadRemovalCommand};
