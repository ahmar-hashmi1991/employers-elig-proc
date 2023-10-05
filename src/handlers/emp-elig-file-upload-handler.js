const AWS = require('aws-sdk');

// * Need to check if this variable exists in aws credentials?
const BUCKET = process.env.EmployersBucket;

const db = require('../services/rds-data-service');
const s3 = new AWS.S3();

async function checkFolderExists(bucketName, folderName) {
    try {
        //* Check if the folder exists by trying to retrieve its metadata
        const params = {
        Bucket: bucketName,
        Key: folderName
        };

        await s3.headObject(params).promise();

        //* If headObject does not throw an error, the folder exists
        return true;
    } catch (error) {
        //* If headObject throws a "NotFound" error, the folder does not exist
        if (error.code === 'NotFound') {
        return false;
        }

        //* Handle other errors
        console.error('Error:', error);
        throw error;
    }
}

async function uploadFileToS3({bucketName, fileName, fileData, contentType}) {
    console.log("file name ---->>", fileName)
    const bufferData = Buffer.from(fileData, 'base64');
    console.log("buffer data ---->>", bufferData)
    return await s3.upload({
        Bucket: bucketName,
        Key: fileName,
        Body: bufferData,
        ContentEncoding: 'base64',
        ContentType: contentType,
        Metadata: {
            'Content-Type': contentType
        }
    }).promise();

    // *For Future Reference
    // const fileStream = fs.createReadStream(file.path);
    // const params = {
    //     Bucket: bucketName,
    //     Key: fileName,
    //     Body: fileStream
    // };
    // await s3.putObject(params).promise();
    // console.log(`File "${fileName}" uploaded to bucket "${bucketName}"`);
}

exports.empEligFileUploadHandler = async (event, context) => {
    console.log('Inside empEligFileUploadHanlder API --->')
    const respObj = {statusCode: 200, body: 'File uploaded successfully!'}
    try{
        //* Get Employer ID and File from params
        let {employer_id: eid, contentType, fileData, fileName} = JSON.parse(event.body)
        console.log('data --->>', eid, contentType, fileData, fileName)

        //* Fetch employer data (specifically folder name)
        let [employerData] =  await db.getEmployerFolderNameByEid(eid)
        console.log("Employer Data ---->>>>", employerData)
        if( !employerData || employerData instanceof Array && employerData.length === 0) {
            throw new Error('Folder name not found!')
        }
        // * If data is there, then it'll be inside an array again(verified)
        let folder = employerData[0].folder

        // * If there is not slash then adding it
        if( folder[folder.length-1] !== '/' ) folder += '/';
        console.log('folder name --->>', folder)

        // * If folder name which is coming from db doesn't contains any keyword like eligibility then we are adding it so to create appropriate folder structure
        if( !folder.includes('eligibility/incoming') ) folder += 'eligibility/incoming/'

        //* Check if folder exists with this folder name in s3
        let folderExists = await checkFolderExists(BUCKET,folder)
        console.log('Folder Exists --->>>', folderExists)

        //* Create folder in s3 with that folder name if not exist
        if( !folderExists ){
            const params = {
                Bucket: BUCKET,
                Key: folder,
                Body: '',
            };
            const s3Upload = await s3.upload(params).promise();
            if (!s3Upload) {
                return {
                    statusCode: 500,
                    body: `Folder could not be created with name: ${folder}`
                };
            }
        }

        console.log('folder exists and now will upload files!')

        //* upload file from fetching it
        let isFileUploaded = await uploadFileToS3({ bucketName: BUCKET, fileName: `${folder}${fileName}`, fileData, contentType })
        console.log('Is File Uploaded --->>>', isFileUploaded)


        //* send response
        if( !isFileUploaded ){
            throw new Error("File upload unsuccessful");
        }
        return respObj

    }catch(e){
        respObj.statusCode = 500
        respObj.body = 'Internal server error'
        respObj.message = e.message
        return respObj
    }
}
