const {app,BrowserWindow,shell}=require('electron');
const path=require('node:path');
app.whenReady().then(()=>{
 const create=()=>{
  const win=new BrowserWindow({width:1440,height:960,minWidth:800,minHeight:600,backgroundColor:'#f7f8fa',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.loadFile(path.join(__dirname,'dist/index.html'));
 };
 create();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)create();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
