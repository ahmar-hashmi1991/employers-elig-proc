const AWS = require('aws-sdk');
const BUCKET = process.env.ArchiveBucket;
const s3 = new AWS.S3();
const db = require('../../services/rds-data-service');

function validateFileType(fileType) {
    if (!fileType) {
      return false;
    }
    const acceptedFileTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-powerpoint',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ];
    const isFileAccepted = acceptedFileTypes.includes(fileType.toLowerCase());
    if (!isFileAccepted) {
      return false;
    }
    return true;
}

async function employerFilePathCheck (employer_id) {
    const [employer] = await db.getEmployer(employer_id);
    const filePath = employer[0].file_path;
    if (!filePath) {
        return false;
    }
    return true;
}

exports.employerFileUploadOperationHandler = async (event, context) => {
    try {
        const {fileData, fileName, contentType} = JSON.parse(event.body);
        const bufferData = Buffer.from(fileData, 'base64');
        const employerId = event.pathParameters.employerId;
        const isFileValid = validateFileType(contentType);
        if (!isFileValid) {
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Not a valid file type'})
            };
        }
        const isFilePathPresent = await employerFilePathCheck(employerId)
        if (isFilePathPresent) {
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'file_path already present for the employer. Delete previous file before uploading new'})
            };
        }
        const params = {
            Bucket: BUCKET,
            Key: `employer_files/${employerId}/${fileName}`,
            Body: bufferData,
            ContentEncoding: 'base64',
            ContentType: contentType,
            ACL: 'public-read-write',
            Metadata: {
                'Content-Type': contentType
            }
        };
        const s3Res = await s3.upload(params).promise();
        if (!!s3Res) {
            const link = s3Res.Location
            const employerParams = {
                external_id: employerId,
                file_path: link
            }
            const res = await db.updateEmployerFilePath(employerParams);
            if (!res || res.length === 0) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({status: 'Something went wrong', result: link})
                };
            } else {
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        status: 'Employer file has been uploaded successfully',
                        result: link
                    })
                };
            }
        } else {
            return {
                statusCode: 409,
                body: JSON.stringify({status: 'Something went wrong. File could not be uploaded'})
            };
        }
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Something went wrong. Please upload the Valid File' })
        }
    }
}
