export const DRONE_CAMERA_MODES=Object.freeze(["follow","third","fpv"]);
export const WALK_CAMERA_MODE="walk";

const VALID_DRONE_CAMERA_MODES=new Set(DRONE_CAMERA_MODES);

export function normalizeDroneCameraMode(value){
  return VALID_DRONE_CAMERA_MODES.has(value)?value:"follow";
}

export class PlayerCameraModePolicy{
  constructor({dronePreference="follow",playerMode="drone"}={}){
    this.dronePreference=normalizeDroneCameraMode(dronePreference);
    this.playerMode=playerMode==="foot"?"foot":"drone";
  }

  get effectiveMode(){return this.playerMode==="foot"?WALK_CAMERA_MODE:this.dronePreference;}

  setPlayerMode(mode){
    this.playerMode=mode==="foot"?"foot":"drone";
    return this.snapshot();
  }

  setDronePreference(mode){
    this.dronePreference=normalizeDroneCameraMode(mode);
    return this.snapshot();
  }

  cycleDronePreference(){
    const index=DRONE_CAMERA_MODES.indexOf(this.dronePreference);
    this.dronePreference=DRONE_CAMERA_MODES[(index+1)%DRONE_CAMERA_MODES.length];
    return this.snapshot();
  }

  snapshot(){
    return Object.freeze({playerMode:this.playerMode,dronePreference:this.dronePreference,effectiveMode:this.effectiveMode});
  }
}
