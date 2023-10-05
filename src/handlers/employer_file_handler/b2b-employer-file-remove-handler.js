const AWS = require('aws-sdk');
const BUCKET = process.env.ArchiveBucket;
const s3 = new AWS.S3();
const db = require('../../services/rds-data-service');

exports.employerFileRemoveHandler = async (event, context) => {

    console.log('event in the file handler ', JSON.parse(event.body));
    try {
        const employerId =  event.pathParameters.employerId;
        let [emp] = await db.getEmployer(employerId);
        console.log('inside the emp', emp[0].file_path)
        if(!!emp[0] && !!emp[0].file_path){
        let pathArray = emp[0].file_path.split('/');
        console.log('pathArray', pathArray)
        let fileName = pathArray[pathArray.length-1];
        console.log('fileName',fileName)
        if (!emp) {
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Something went wrong'}),
            };
        } else {
            const params = {
                Bucket: BUCKET,
                Key: `employer_files/${employerId}/${fileName}`
            };
            console.log('call inside the if ', params)
            const s3Res = await s3.deleteObject(params).promise();
            console.log('CONTENT TYPE:', s3Res);
            if (!!s3Res) {
                let params ={
                    external_id : employerId,
                    file_path : null
                }
                let res = await db.updateEmployerFilePath(params);
                console.log(' result of the update',res)
                if (!res || res.length === 0) {
                    return {
                        statusCode: 409,
                        body: JSON.stringify({status: 'Something went wrong'})
                    };
                } else {
                    return {
                        statusCode: 200,
                        body: JSON.stringify({
                            status: 'SUCCESS',
                            result: 'Employer file has been Removed Successfully'
                        })
                    };
                }
            }
            else {
                return {
                    statusCode: 409,
                    body: JSON.stringify({status: 'Something went wrong'}),
                    result :s3Res
                };
            }
        }
        } else {
            return {
                statusCode: 500,
                result :'There is no File to Remove'
            };
        }
    } catch (err) {
        console.log('call inside the catch block ', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Something went wrong, Please try after Some Time '})
        }
    }
}
