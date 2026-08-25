import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),executablePath=process.env.CHROME_BIN;if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]}),page=await browser.newPage();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld?.threeScene&&document.querySelector("#viewport")?.dataset.worldPeople,{timeout:40000});
  const before=await page.evaluate(()=>{const scene=globalThis.__arondightRealWorld?.threeScene;let person=null;scene?.traverse(node=>{if(person||!node?.isGroup||node.visible===false||node.userData?.worldPopulationKind!=="person")return;const left=node.getObjectByName?.("WORLD_PERSON_ARM_L"),right=node.getObjectByName?.("WORLD_PERSON_ARM_R");if(left&&right)person=node;});if(!person)return null;const p=person.position.clone();globalThis.__panicSmokePersonId=String(person.userData.worldPopulationId||person.userData.worldProceduralId||"");window.dispatchEvent(new CustomEvent("arondight:world-gunshot",{detail:{position:[p.x-2,p.y,p.z+1.4],source:"browser-smoke",weapon:"pistol"}}));return{id:globalThis.__panicSmokePersonId,x:p.x,y:p.y,leftZ:person.getObjectByName("WORLD_PERSON_ARM_L")?.position.z,rightZ:person.getObjectByName("WORLD_PERSON_ARM_R")?.position.z};});
  if(!before?.id)throw new Error("no visible named procedural pedestrian available");
  await sleep(420);
  const during=await page.evaluate(()=>{const id=globalThis.__panicSmokePersonId;let person=null;globalThis.__arondightRealWorld?.threeScene?.traverse(node=>{if(!person&&node?.isGroup&&String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"")===id)person=node;});if(!person)return null;const left=person.getObjectByName?.("WORLD_PERSON_ARM_L"),right=person.getObjectByName?.("WORLD_PERSON_ARM_R"),v=document.querySelector("#viewport");return{x:person.position.x,y:person.position.y,fsm:person.userData.worldPedestrianFsm,handsUp:person.userData.worldPedestrianHandsUp,leftZ:left?.position.z,rightZ:right?.position.z,panicCount:Number(v?.dataset.worldPedestrianPanicCount||0),lastAffected:Number(v?.dataset.worldPedestrianPanicLastAffected||0),contract:v?.dataset.worldPedestrianPanic};});
  const moved=Math.hypot((during?.x??before.x)-before.x,(during?.y??before.y)-before.y);
  if(!during||during.fsm!=="panic"||during.handsUp!==true||during.leftZ<1.35||during.rightZ<1.35||moved<.35||during.panicCount<1||during.lastAffected<1||during.contract!=="gunshot+explosion-flee+hands-up+scream-v1")throw new Error(`pedestrian panic runtime failed: ${JSON.stringify({before,during,moved})}`);
  console.log(`Pedestrian panic browser smoke passed: moved=${moved.toFixed(2)}m, arms=${during.leftZ.toFixed(2)}/${during.rightZ.toFixed(2)}, active=${during.panicCount}.`);
}finally{await browser.close();}
