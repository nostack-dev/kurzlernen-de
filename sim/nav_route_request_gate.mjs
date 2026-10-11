// A navigation request is valid only for its current destination/profile epoch.
// Aborting the old fetch also invalidates any late response/json promise.
export class NavRouteRequestGate {
  constructor(){this.generation=0;this.active=null;}
  begin(key){
    this.cancel();
    const request={generation:this.generation,key:String(key),controller:new AbortController()};
    request.signal=request.controller.signal;
    this.active=request;
    return request;
  }
  cancel(){
    ++this.generation;
    const old=this.active;
    this.active=null;
    old?.controller.abort();
  }
  owns(request){return Boolean(request&&this.active===request&&!request.signal.aborted);}
  finish(request){if(this.active!==request)return false;this.active=null;return true;}
}
