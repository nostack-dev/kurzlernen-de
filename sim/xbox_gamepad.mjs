export const XBOX_GAMEPAD_DEADZONE=.14;

export const XBOX_STANDARD_BUTTON=Object.freeze({
  A:0,
  B:1,
  X:2,
  Y:3,
  LEFT_SHOULDER:4,
  RIGHT_SHOULDER:5,
  LEFT_TRIGGER:6,
  RIGHT_TRIGGER:7,
});

function clamp(value,min=-1,max=1){return Math.max(min,Math.min(max,Number(value)||0));}

export function gamepadAxis(value,deadzone=XBOX_GAMEPAD_DEADZONE){
  const raw=clamp(value),magnitude=Math.abs(raw),zone=clamp(deadzone,0,.5);
  if(magnitude<=zone)return 0;
  return Math.sign(raw)*(magnitude-zone)/(1-zone);
}

function buttonValue(gamepad,index){
  const button=gamepad?.buttons?.[index];
  if(typeof button==="number")return clamp(button,0,1);
  return clamp(button?.value??(button?.pressed?1:0),0,1);
}
function rawInputActive(gamepad){
  if(Array.from(gamepad?.axes||[]).some(value=>Math.abs(Number(value)||0)>.18))return true;
  return Array.from(gamepad?.buttons||[]).some(button=>Number(typeof button==="number"?button:(button?.value??(button?.pressed?1:0)))>.18);
}
function neutralSample(gamepad){
  return Object.freeze({id:String(gamepad.id||"Xbox controller"),index:Number(gamepad.index)||0,left:Object.freeze({x:0,y:0}),right:Object.freeze({x:0,y:0}),leftTrigger:0,rightTrigger:0,heightAxis:0,aim:false,fire:false,arm:false,kill:false,camera:false,target:false});
}

export function isXboxCompatibleGamepad(gamepad){
  if(!gamepad?.connected)return false;
  return gamepad.mapping==="standard"||/xbox|xinput|045e/i.test(String(gamepad.id||""));
}

export function findXboxGamepad(gamepads){
  return Array.from(gamepads||[]).find(isXboxCompatibleGamepad)||null;
}

export function sampleXboxGamepad(gamepad){
  if(!isXboxCompatibleGamepad(gamepad))return null;
  const modalOpen=globalThis.__arondightSettingsModalOpen===true,releaseBlock=globalThis.__arondightSettingsGamepadBlockUntilRelease===true;
  if(modalOpen||releaseBlock){
    if(!modalOpen&&releaseBlock&&!rawInputActive(gamepad))globalThis.__arondightSettingsGamepadBlockUntilRelease=false;
    return neutralSample(gamepad);
  }
  const left={x:gamepadAxis(gamepad.axes?.[0]),y:gamepadAxis(gamepad.axes?.[1])};
  const right={x:gamepadAxis(gamepad.axes?.[2]),y:gamepadAxis(gamepad.axes?.[3])};
  const leftTrigger=buttonValue(gamepad,XBOX_STANDARD_BUTTON.LEFT_TRIGGER);
  const rightTrigger=buttonValue(gamepad,XBOX_STANDARD_BUTTON.RIGHT_TRIGGER);
  const aim=buttonValue(gamepad,XBOX_STANDARD_BUTTON.LEFT_SHOULDER)>.5;
  const rightShoulder=buttonValue(gamepad,XBOX_STANDARD_BUTTON.RIGHT_SHOULDER)>.5;
  return Object.freeze({
    id:String(gamepad.id||"Xbox controller"),
    index:Number(gamepad.index)||0,
    left,
    right,
    leftTrigger,
    rightTrigger,
    heightAxis:Math.abs(rightTrigger-leftTrigger)<.05?0:clamp(rightTrigger-leftTrigger),
    aim,
    fire:aim&&rightShoulder,
    arm:buttonValue(gamepad,XBOX_STANDARD_BUTTON.A)>.5,
    kill:buttonValue(gamepad,XBOX_STANDARD_BUTTON.B)>.5,
    camera:buttonValue(gamepad,XBOX_STANDARD_BUTTON.X)>.5,
    target:buttonValue(gamepad,XBOX_STANDARD_BUTTON.Y)>.5,
  });
}
