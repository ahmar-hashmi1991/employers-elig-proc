
const matchDataByUniquePrimaryKey = async (fileData, primaryKeys, membersObj) => {
    console.log(`matchDataByUniquePrimaryKey primaryKeys: ${primaryKeys}`);
    // console.log(`matchDataByUniquePrimaryKey primaryKeys: ${primaryKeys},fileData: ${JSON.stringify(fileData)}`);
    let primaryKey = null;
    fileData.length && fileData.forEach(obj => {
        primaryKey = primaryKey || extractPrimaryKey(primaryKeys, obj);
        console.log(`primaryKey ${primaryKey}`);
        console.log("obj", obj);
        if(!obj[primaryKey]){
            return membersObj;
        }
        if(membersObj[obj[primaryKey]]){
            console.log("assigning to existing object", membersObj[obj[primaryKey]], obj[primaryKey]);
            Object.assign(membersObj[obj[primaryKey]], obj);
        } else {
            console.log("assinging to new key", obj[primaryKey]);
            membersObj[obj[primaryKey]] = obj;
        }
    })
    return membersObj;
}

function extractPrimaryKey(primaryKeys, obj){
    const objKeys = Object.keys(obj);
    return primaryKeys.find(prKey => objKeys.includes(prKey))
}


const orderDataByPrimaryGroupKeyAndFileName = async (fileData, primaryKey, membersObj, fileName) => {
    fileData.length && fileData.forEach(obj => {
        if(membersObj[obj[primaryKey]]){
            if(!membersObj[obj[primaryKey]][fileName]){
              membersObj[obj[primaryKey]][fileName]= []
            } 
            membersObj[obj[primaryKey]][fileName].push(obj);
          } else {
              membersObj[obj[primaryKey]] = {[fileName]:[obj]};
          }
    })
    return membersObj;
}


module.exports = {
    matchDataByUniquePrimaryKey,
    orderDataByPrimaryGroupKeyAndFileName
}