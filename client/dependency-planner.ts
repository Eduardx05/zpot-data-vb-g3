/**
 * Relationship-driven migration plan for Oracle Visual Builder Business Objects.
 * An outgoing relationship maps a child field to the parent Business Object.
 */
type ZpotRelation={field:string;target:string;name?:string;delete?:string};
type ZpotEdge={parent:string;child:string;field:string;name?:string};
type ZpotPlan={stages:string[][];edges:ZpotEdge[];external:ZpotEdge[];selfReferences:ZpotEdge[];cycles:string[][];unplanned:string[];order:string[]};
function dependencyPlan(selected:readonly string[],outgoing:Record<string,readonly ZpotRelation[]>):ZpotPlan{
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
 const indegree=new Map(nodes.map(n=>[n,requirements.get(n)!.size])),stages:string[][]=[];
 let ready=nodes.filter(n=>indegree.get(n)===0);
 while(ready.length){
  const stage=[...ready].sort();stages.push(stage);const next=new Set<string>();
  for(const parent of stage)for(const child of children.get(parent)!){
   indegree.set(child,indegree.get(child)!-1);if(indegree.get(child)===0)next.add(child);
  }
  ready=[...next];
 }
 const unplanned=nodes.filter(n=>indegree.get(n)!>0),pending=new Set(unplanned),index=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],inStack=new Set<string>(),cycles:string[]=[];
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
 return {stages,edges,external,selfReferences,cycles,unplanned,order:stages.flat()};
}
(globalThis as typeof globalThis & {ZPOTDependencyPlanner?:typeof dependencyPlan}).ZPOTDependencyPlanner=dependencyPlan;
