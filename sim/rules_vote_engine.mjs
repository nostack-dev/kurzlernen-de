// Pure unanimous-vote state machine. Only current roster can vote; no additions during a ballot.
export function createBallot({id,key,value,host,members,now=Date.now()}){
  const voters=[...new Set(members)].sort();
  if(!id||!key||typeof value!=="boolean"||!host||!voters.includes(host)||voters.length<2)throw Error("invalid ballot");
  return{id,key,value,host,members:voters,yes:new Set([host]),expires:now+30000,status:"pending"};
}
export function vote(ballot,peer,approve,currentMembers,now=Date.now()){
  if(!ballot||ballot.status!=="pending")return ballot?.status||"invalid";
  if(now>=ballot.expires||currentMembers.slice().sort().join("|")!==ballot.members.join("|")){ballot.status="cancelled";return ballot.status;}
  if(!ballot.members.includes(peer)||ballot.yes.has(peer))return "ignored";
  if(approve!==true){ballot.status="rejected";return ballot.status;}
  ballot.yes.add(peer);
  if(ballot.members.every(id=>ballot.yes.has(id)))ballot.status="approved";
  return ballot.status;
}
