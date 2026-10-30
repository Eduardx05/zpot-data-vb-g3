/**
 * Relationship-driven migration plan for Oracle Visual Builder Business Objects.
 * An outgoing relationship maps a child field to the parent Business Object.
 */
type ZpotRelation={field:string;target:string;name?:string;delete?:string};
type ZpotEdge={parent:string;child:string;field:string;name?:string};
type ZpotOrderRule={before:string;after:string;label?:string};
type ZpotPlan={stages:string[][];edges:ZpotEdge[];orderEdges:ZpotEdge[];external:ZpotEdge[];selfReferences:ZpotEdge[];cycles:string[][];unplanned:string[];order:string[]};
function dependencyPlan(selected:readonly string[],outgoing:Record<string,readonly ZpotRelation[]>,rules:readonly ZpotOrderRule[]=[]):ZpotPlan{
 const nodes=[...new Set(selected.filter(n=>/^[A-Za-z][A-Za-z0-9_]*$/.test(n)))].sort();
 const set=new Set(nodes),edges:ZpotEdge[]=[],external:ZpotEdge[]=[],selfReferences:ZpotEdge[]=[];
 const seen=new Set<string>(),requirements=new Map(nodes.map(n=>[n,new Set<string>()])),children=new Map(nodes.map(n=>[n,new Set<string>()]));
 for(const child of nodes)for(const r of outgoing[child]||[]){
  if(!r?.field||!r?.target||!/^[A-Za-z][A-Za-z0-9_]*$/.test(r.target))continue;
  const key=`${child}.${r.field}->${r.target}`;if(seen.has(key))continue;seen.add(key);
  const edge={parent:r.target,child,field:r.field,name:r.name};
  if(r.target===child){selfReferences.push(edge);continue}
  if(!set.has(r.target)){external.push(edge);continue}
  edges.push(edge);requirements.get(child)!.add(r.target);children.get(r.target)!.add(child);
 }
 // Explicit business precedence is NOT a foreign key. Keep it separate from edges
 // so neither the diagram nor FK verification treats it as a database relation.
 const orderEdges:ZpotEdge[]=[];
 for(const rule of rules){
  if(!set.has(rule.before)||!set.has(rule.after)||rule.before===rule.after)continue;
  if(requirements.get(rule.after)!.has(rule.before))continue;
  requirements.get(rule.after)!.add(rule.before);
  children.get(rule.before)!.add(rule.after);
  orderEdges.push({parent:rule.before,child:rule.after,field:'Orden de carga',name:rule.label||'Precedencia de negocio (no es FK)'});
 }
 const indegree=new Map(nodes.map(n=>[n,requirements.get(n)!.size])),stages:string[][]=[];
 let ready=nodes.filter(n=>indegree.get(n)===0);
 while(ready.length){
  const stage=[...ready].sort();stages.push(stage);const next=new Set<string>();
  for(const parent of stage)for(const child of children.get(parent)!){
   indegree.set(child,indegree.get(child)!-1);if(indegree.get(child)===0)next.add(child);
  }
  ready=[...next];
 }
 const unplanned=nodes.filter(n=>indegree.get(n)!>0),pending=new Set(unplanned),index=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],inStack=new Set<string>(),cycles:string[][]=[];
 let pos=0;
 const visit=(node:string):void=>{
  index.set(node,pos);low.set(node,pos);pos++;stack.push(node);inStack.add(node);
  for(const target of requirements.get(node)!)if(pending.has(target)){
   if(!index.has(target)){visit(target);low.set(node,Math.min(low.get(node)!,low.get(target)!))}
   else if(inStack.has(target))low.set(node,Math.min(low.get(node)!,index.get(target)!));
  }
  if(low.get(node)===index.get(node)){
   const component:string[]=[];let item:string;
   do{item=stack.pop()!;inStack.delete(item);component.push(item)}while(item!==node);
   if(component.length>1)cycles.push(component.sort());
  }
 };
 for(const n of unplanned)if(!index.has(n))visit(n);
 return {stages,edges,orderEdges,external,selfReferences,cycles,unplanned,order:stages.flat()};
}
(globalThis as typeof globalThis & {ZPOTDependencyPlanner?:typeof dependencyPlan}).ZPOTDependencyPlanner=dependencyPlan;

/**
 * CSV-only Data Manager ZIPs do not contain entity.json relationship metadata.
 * Infer ONLY when the column name is an exact, case-insensitive BO name match.
 * This is deliberately conservative: no fuzzy matches and no fabricated FKs.
 */
function inferRelationshipsFromFields(
 child:string,
 fields:readonly (string|{name:string;type?:string})[],
 availableObjects:readonly string[]
):ZpotRelation[]{
 const targets=new Map<string,string>();
 for(const name of availableObjects){
  if(name!==child&&/^[A-Za-z][A-Za-z0-9_]*$/.test(name)){
   const key=name.toLowerCase();
   if(!targets.has(key))targets.set(key,name);
  }
 }
 const result:ZpotRelation[]=[],seen=new Set<string>();
 for(const item of fields){
  const field=typeof item==='string'?item:item?.name;
  if(!field||seen.has(field.toLowerCase()))continue;
  const target=targets.get(field.toLowerCase());
  if(!target)continue;
  result.push({field,target,name:'Inferida por nombre exacto de columna ID (revisar esquema)'});
  seen.add(field.toLowerCase());
 }
 return result;
}
(globalThis as typeof globalThis & {
 ZPOTDependencyInference?:typeof inferRelationshipsFromFields
}).ZPOTDependencyInference=inferRelationshipsFromFields;


/**
 * Completing a publication selection is purely local: available parents are
 * included recursively, while missing parents remain external references
 * to be checked against Oracle by the publisher before writing.
 */
type ZpotExpandedSelection={selected:string[];added:string[];missing:string[]};
function selectRequiredParents(
 selected:readonly string[],
 available:readonly string[],
 outgoing:Record<string,readonly ZpotRelation[]>
):ZpotExpandedSelection{
 const permitted=new Set(available);
 const chosen=new Set(selected.filter(name=>permitted.has(name)));
 const initial=new Set(chosen);
 const visited=new Set<string>(),missing=new Set<string>();
 const visit=(child:string):void=>{
  if(visited.has(child))return;
  visited.add(child);
  for(const rel of outgoing[child]||[]){
   const parent=rel?.target;
   if(!parent||parent===child||!/^[A-Za-z][A-Za-z0-9_]*$/.test(parent))continue;
   if(!permitted.has(parent)){missing.add(child+' → '+parent);continue;}
   chosen.add(parent);
   visit(parent);
  }
 };
 for(const name of [...chosen])visit(name);
 return {
  selected:[...chosen].sort(),
  added:[...chosen].filter(name=>!initial.has(name)).sort(),
  missing:[...missing].sort()
 };
}
/** Unchecking a parent also unchecks every selected dependent (transitively). */
function deselectWithDependents(
 selected:readonly string[],
 parent:string,
 outgoing:Record<string,readonly ZpotRelation[]>
):{selected:string[];removed:string[]}{
 const chosen=new Set(selected);
 const removed=new Set<string>();
 const queue=[parent];
 for(let i=0;i<queue.length;i++){
  const current=queue[i];
  if(!chosen.has(current)||removed.has(current))continue;
  removed.add(current);
  for(const child of chosen){
   if(removed.has(child))continue;
   if((outgoing[child]||[]).some(rel=>rel?.target===current))queue.push(child);
  }
 }
 for(const name of removed)chosen.delete(name);
 return {selected:[...chosen].sort(),removed:[...removed].sort()};
}
(globalThis as typeof globalThis & {
 ZPOTDependencySelection?:{withParents:typeof selectRequiredParents;withoutParent:typeof deselectWithDependents}
}).ZPOTDependencySelection={withParents:selectRequiredParents,withoutParent:deselectWithDependents};

