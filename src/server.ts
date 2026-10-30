import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {readFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const dataDir = resolve(projectRoot, 'private-data');
const publicDir = resolve(here, 'public');

function loadEnvFile(): void {
  const file = resolve(projectRoot, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || Object.hasOwn(process.env, m[1])) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
loadEnvFile();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8765);
if (!['127.0.0.1', 'localhost'].includes(HOST)) throw new Error('Por seguridad solo se permite HOST=127.0.0.1 o localhost.');
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('PORT fuera de rango.');
const ORACLE_HOST = 'oic-vbcs-oicdesarrollo-vb-idmgdptbgc3i.builder.us-ashburn-1.ocp.oraclecloud.com';
const ORACLE_PATH = '/ic/builder/rt/BNCR_CREDIT_APPROVAL_2026_GEN3_V2/live/resources/data';
const ORACLE_BASE = new URL(process.env.ORACLE_DATA_BASE_URL || `https://${ORACLE_HOST}${ORACLE_PATH}`);
if (ORACLE_BASE.protocol !== 'https:' || ORACLE_BASE.hostname !== ORACLE_HOST || ORACLE_BASE.pathname.replace(/\/+$/, '') !== ORACLE_PATH || ORACLE_BASE.username || ORACLE_BASE.password || ORACLE_BASE.search || ORACLE_BASE.hash) {
  throw new Error('El destino Oracle no pertenece al ambiente autorizado de OIC Desarrollo.');
}
const ENABLE_WRITES = process.env.ENABLE_ORACLE_WRITES === 'true';
const AUTH_MODE = process.env.ORACLE_AUTH_MODE === 'bearer' ? 'bearer' : 'public';
const TOKEN = process.env.ORACLE_BEARER_TOKEN || '';
if (AUTH_MODE === 'bearer' && !TOKEN) throw new Error('ORACLE_BEARER_TOKEN requerido cuando ORACLE_AUTH_MODE=bearer.');
mkdirSync(dataDir, {recursive: true});
const demoDir=resolve(projectRoot,'demo-data');
const PLACEHOLDER = [{id:'empty-source',filename:'Sin ZIP cargados',defaultLabel:'Sin datos — agrega un ZIP',sha:'empty-source',bytes:0,isApp:false,kind:'Datos CSV',tables:{},stats:{tableCount:0,cases:0,active:0,totalRows:0,states:{},lines:{}},pack:null}];
function privateJson(name: string, fallback: unknown): string {
  const file = resolve(dataDir, name);
  if (!existsSync(file)) {const demo=resolve(demoDir,name);if(existsSync(demo))return readFileSync(demo,'utf8').replace(/<\//g,'<\\/'); return JSON.stringify(fallback).replace(/</g,'\\u003c');}
  const raw = readFileSync(file, 'utf8');
  JSON.parse(raw);
  return raw.replace(/<\//g, '<\\/');
}
let html: string;
function buildHtml(): string {
  let template = readFileSync(resolve(publicDir,'index.template.html'),'utf8');
  const inserts: Record<string,string> = {
    '__ZPOT_REFERENCE_DATA__': privateJson('reference.json',{maintenances:[],referenceCatalogs:{},traces:[]}),
    '__ZPOT_SOURCES_DATA__': privateJson('sources.json',PLACEHOLDER),
    '__ZPOT_PACKS_DATA__': privateJson('packs.json',{})
  };
  for (const [tag,json] of Object.entries(inserts)) {
    if (!template.includes(tag)) throw new Error('El HTML no contiene el marcador '+tag);
    template = template.replace(tag,json);
  }
  return template;
}
html = buildHtml();

function send(res: ServerResponse, status: number, payload: string, type='application/json; charset=utf-8',extraHeaders:Record<string,string>={}): void {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'",...extraHeaders});
  res.end(payload);
}
function json(res:ServerResponse,status:number,data:unknown):void {send(res,status,JSON.stringify(data));}
async function readBody(req:IncomingMessage,max=1024*1024):Promise<string> {
  const chunks:Buffer[]=[];let length=0;
  for await (const chunk of req) {
    const buf=Buffer.from(chunk);length+=buf.length;
    if(length>max)throw Object.assign(new Error('Payload demasiado grande.'),{code:413});
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function checkLocalRequest(req:IncomingMessage):boolean {
  const host=req.headers.host?.split(':')[0]?.toLowerCase();
  if(!host || !['127.0.0.1','localhost'].includes(host)) return false;
  const origin=req.headers.origin;
  if(origin) {
    try {const u=new URL(origin);if(u.protocol!=='http:' || !['127.0.0.1','localhost'].includes(u.hostname) || Number(u.port || 80)!==PORT) return false;}
    catch {return false;}
  }
  const site=req.headers['sec-fetch-site'];
  if(site && !['same-origin','none'].includes(String(site))) return false;
  return true;
}
async function oracle(req:IncomingMessage,res:ServerResponse,url:URL):Promise<void> {
  const match = url.pathname.match(/^\/api\/oracle\/([A-Za-z][A-Za-z0-9_]*)(?:\/([A-Za-z0-9._~-]+))?\/?$/);
  if (!match) return json(res,400,{error:'Nombre de objeto o identificador inválido.'});
  const method=(req.method||'GET').toUpperCase();
  if(!['GET','POST','PATCH'].includes(method))return json(res,405,{error:'Método no permitido.'});
  if(method==='POST' && match[2])return json(res,400,{error:'POST solamente sobre la colección.'});
  if(method==='PATCH' && !match[2])return json(res,400,{error:'PATCH requiere identificador.'});
  if(method!=='GET'){
    if(!ENABLE_WRITES) return json(res,403,{error:'Escritura deshabilitada. Configura ENABLE_ORACLE_WRITES=true solamente en desarrollo.'});
    if(req.headers['x-zpot-write-confirm']!=='CARGAR DESARROLLO'||req.headers['x-zpot-request']!=='1')return json(res,403,{error:'Falta confirmación explícita de escritura.'});
  }
  let body:string|undefined;
  if(method!=='GET'){
    body=await readBody(req);
    try {const p=JSON.parse(body);if(!p||typeof p!=='object'||Array.isArray(p))throw Error('objeto');}
    catch {return json(res,400,{error:'Se requiere un objeto JSON válido.'});}
  }
  const upstream=new URL(ORACLE_BASE.toString().replace(/\/+$/,'')+'/'+match[1]+(match[2]?'/'+encodeURIComponent(match[2]):''));
  if(method==='GET'){
    for(const key of ['limit','offset']){
      const v=url.searchParams.get(key);
      if(v!==null){if(!/^\d+$/.test(v)||Number(v)>10000)return json(res,400,{error:'Parámetro de paginación inválido.'});upstream.searchParams.set(key,v);}
    }
    // Only constrained equality filters are exposed to the local publisher.
    // This is for exact unique-key reconciliation; reject general user-supplied queries.
    const q=url.searchParams.get('q');
    if(q!==null){
      if(match[2]||q.length>512||!/^[A-Za-z][A-Za-z0-9_]*\s*=\s*(?:'(?:[^']|'')*'|[+-]?\d+(?:\.\d+)?)$/.test(q))
        return json(res,400,{error:'Filtro de clave única inválido.'});
      upstream.searchParams.set('q',q);
    }
  }
  const headers:Record<string,string>={Accept:'application/json',Authorization:AUTH_MODE==='public'?'Public':'Bearer '+TOKEN};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(req.headers['upsert-mode']==='true')headers['Upsert-Mode']='true';
  const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),25000);
  try {
    const r=await fetch(upstream,{method,headers,body,redirect:'manual',signal:abort.signal});
    if(r.status>=300 && r.status<400)return json(res,502,{error:'Oracle intentó redirigir la solicitud; operación detenida.'});
    const response=await r.text();
    if(response.length>4*1024*1024)return json(res,502,{error:'Respuesta de Oracle demasiado grande.'});
    const ct=r.headers.get('content-type')||'';
    if(!/json/i.test(ct) && /^\s*</.test(response))return json(res,502,{error:'Oracle devolvió HTML en vez de JSON; revisa permisos y autenticación.'});
    const exposedHeaders:Record<string,string>={};
    // Some Oracle BO POST responses return 201 + Location but omit body.id.
    // Extract only the final safe identifier, never expose the Location URL.
    if(method==='POST' && r.ok){
      const location=r.headers.get('location');
      if(location)try{
        const u=new URL(location,upstream);
        const collection=ORACLE_PATH+'/'+match[1]+'/';
        if(u.origin===ORACLE_BASE.origin&&u.pathname.startsWith(collection)){
          const suffix=u.pathname.slice(collection.length);
          if(/^[A-Za-z0-9._~-]+$/.test(suffix))
            exposedHeaders['X-ZPOT-Oracle-Id']=suffix;
        }
      }catch{/* Invalid or unrelated Location is not trusted. */}
    }
    send(res,r.status,response||'{}','application/json; charset=utf-8',exposedHeaders);
  } catch(e){json(res,502,{error:e instanceof Error&&e.name==='AbortError'?'Tiempo de espera agotado en Oracle.':'No se pudo establecer conexión segura con Oracle.'});}
  finally{clearTimeout(timeout);}
}
/**
 * Oracle Visual Builder Business Objects batch:
 * POST <resources/data> with application/vnd.oracle.adf.batch+json.
 * Unlike the single-record proxy, this accepts multiple atomic operations.
 * The host, application and allowed BO paths remain strictly pinned.
 */
type OracleBatchPart={id:string;path:string;operation:'create'|'update';payload:Record<string,unknown>};
function validateOracleBatch(input:unknown):OracleBatchPart[]{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Batch JSON inválido.');
 const parts=(input as {parts?:unknown}).parts;
 if(!Array.isArray(parts)||parts.length<1||parts.length>25)throw Error('Batch debe contener entre 1 y 25 operaciones.');
 const seen=new Set<string>(),updatePaths=new Set<string>();
 const rows:OracleBatchPart[]=[];
 for(const part of parts){
  if(!part||typeof part!=='object'||Array.isArray(part))throw Error('Operación batch inválida.');
  const {id,path,operation,payload}=part as Record<string,unknown>;
  if(typeof id!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id)||seen.has(id))
   throw Error('Identificador batch duplicado o inválido.');
  seen.add(id);
  if(operation!=='create'&&operation!=='update')throw Error('Batch solo permite crear o actualizar registros.');
  if(typeof path!=='string'||!/^\/[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z0-9._~-]+)?$/.test(path))
   throw Error('Ruta del BO inválida: no admite URLs externas ni parámetros de consulta.');
  const partsPath=path.slice(1).split('/');
  if(operation==='create'&&partsPath.length!==1||operation==='update'&&partsPath.length!==2)
   throw Error('Create requiere colección y update requiere ID.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
   throw Error('La operación batch debe incluir un objeto JSON.');
  if(operation==='update'){
   if(Object.hasOwn(payload,'id'))throw Error('No se puede cambiar la clave primaria con batch update.');
   if(updatePaths.has(path))throw Error('Dos actualizaciones sobre el mismo ID en un batch.');
   updatePaths.add(path);
  }
  rows.push({id,path,operation,payload:payload as Record<string,unknown>});
 }
 return rows;
}
async function oracleBatch(req:IncomingMessage,res:ServerResponse):Promise<void>{
 if(req.method!=='POST')return json(res,405,{error:'Batch requiere POST.'});
 if(!ENABLE_WRITES)return json(res,403,{error:'Escritura batch deshabilitada. ENABLE_ORACLE_WRITES=true solo en desarrollo.'});
 if(req.headers['x-zpot-write-confirm']!=='CARGAR DESARROLLO'||req.headers['x-zpot-request']!=='1')
  return json(res,403,{error:'Falta autorización explícita para la escritura batch.'});
 const raw=await readBody(req,1024*1024);
 let parts:OracleBatchPart[];
 try{parts=validateOracleBatch(JSON.parse(raw));}
 catch(error){return json(res,400,{error:error instanceof Error?error.message:'Batch inválido.'});}
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);
 try{
  const upstream=new URL(ORACLE_BASE.toString());
  const response=await fetch(upstream,{
   method:'POST',redirect:'manual',signal:controller.signal,
   headers:{Authorization:AUTH_MODE==='public'?'Public':'Bearer '+TOKEN,
    Accept:'application/vnd.oracle.adf.batch+json',
    'Content-Type':'application/vnd.oracle.adf.batch+json'},
   body:JSON.stringify({parts})
  });
  if(response.status>=300&&response.status<400)return json(res,502,{error:'Redirección Oracle bloqueada en batch.'});
  const rawResponse=await response.text();
  if(rawResponse.length>4*1024*1024)return json(res,502,{error:'Respuesta batch demasiado grande.'});
  const contentType=response.headers.get('content-type')||'';
  if(!/json/i.test(contentType)||!rawResponse.trim().startsWith('{'))
   return json(res,502,{error:'Oracle no respondió con un JSON batch válido. Estado del lote no confirmado.'});
  // Un HTTP 200 no confirma por sí solo las escrituras: el cliente valida
  // exhaustivamente cada part e ID antes de avanzar al próximo lote.
  send(res,response.status,rawResponse,'application/json; charset=utf-8');
 }catch(error){
  json(res,502,{error:error instanceof Error&&error.name==='AbortError'?
   'Oracle agotó el tiempo para el batch. El resultado del lote es INCIERTO; verifica los IDs antes de reintentar.':
   'Fallo de conexión con Oracle. Estado del lote incierto: no repetir automáticamente.'});
 }finally{clearTimeout(timeout);}
}
const server=createServer(async(req,res)=>{
  if(!checkLocalRequest(req))return json(res,403,{error:'Origen no permitido.'});
  const url=new URL(req.url||'/',`http://127.0.0.1:${PORT}`);
  try{
    if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html'))return send(res,200,html,'text/html; charset=utf-8');
    if(req.method==='GET' && url.pathname==='/status.js')return send(res,200,readFileSync(resolve(publicDir,'status.js'),'utf8'),'text/javascript; charset=utf-8');
    if(req.method==='GET' && ['/dependency-planner.js','/bo-master-model.js','/oracle-id-mapping.js','/oracle-record-sync.js','/configuration-policy.js','/dual-app-merge.js','/dual-app-fusion.js','/oracle-merge-delta.js','/oracle-batch-runner.js'].includes(url.pathname))return send(res,200,readFileSync(resolve(publicDir,url.pathname.slice(1)),'utf8'),'text/javascript; charset=utf-8');
    if(req.method==='GET' && url.pathname==='/api/health')return json(res,200,{ok:true,mode:'local-proxy',writeEnabled:ENABLE_WRITES,authMode:AUTH_MODE,oracleBase:ORACLE_BASE.toString(),preloadedSources:JSON.parse(privateJson('sources.json',PLACEHOLDER)).length});
    if(url.pathname==='/api/oracle-batch')return await oracleBatch(req,res);
    if(url.pathname.startsWith('/api/oracle/'))return await oracle(req,res,url);
    return json(res,404,{error:'Ruta no encontrada.'});
  }catch(e){const code=Number((e as {code?:number}).code)||500;json(res,code,{error:e instanceof Error?e.message:'Error del servidor.'});}
});
server.listen(PORT,HOST,()=>console.log(`ZPOT disponible en http://${HOST}:${PORT} | API Oracle ${ENABLE_WRITES?'ESCRITURA HABILITADA':'solo lectura'}`));
