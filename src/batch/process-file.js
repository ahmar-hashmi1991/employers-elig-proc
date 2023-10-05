const proc = require('../handlers/s3-csv-handler');
const AWS = require('aws-sdk');

AWS.config.loadFromPath('./config.json');

(async () => {
    console.log('START');

    const event = {
        "Records": [
            {
                "eventVersion": "2.1",
                "eventSource": "aws:s3",
                "awsRegion": "us-east-1",
                "eventTime": "2021-01-04T15:04:16.417Z",
                "eventName": "ObjectCreated:Put",
                "userIdentity": {
                    "principalId": "AWS:AIDASBDPSJKC63BRDGGG6"
                },
                "requestParameters": {
                    "sourceIPAddress": "77.125.85.159"
                },
                "responseElements": {
                    "x-amz-request-id": "480959C3CD308624",
                    "x-amz-id-2": "VWhd+gvvoyuHKeVRPQm12nXZfBE2c3PWq2qiKItsJqEyN7YlKrSjOjwnt821rMG2icEZ5X17u2/o/a1gA7nTMfV/X7xCv4jsF/wqmvBAAR8="
                },
                "s3": {
                    "s3SchemaVersion": "1.0",
                    "configurationId": "51231545-079f-48a4-b624-4f9f0c30c98e",
                    "bucket": {
                        "name": "aws-us-east-1-dario-employers-elig-employersbucket-prod",
                        "ownerIdentity": {
                            "principalId": "A30Q9ZLISP3UF"
                        },
                        "arn": "arn:aws:s3:::aws-us-east-1-dario-employers-elig-employersbucket-prod"
                    },
                    "object": {
                        "key": "commscope_t/Eligibility-20210101-CommScope.csv",
                        "size": 1900329,
                        "eTag": "a603aeb549378f48b63b3b67c4d6f6aa",
                        "sequencer": "005FF32E77240FC100"
                    }
                }
            }
        ]
    };
    
    process.env.STAGE = 'prod';

    await proc.s3EmployerFileHandler(event, {});

    console.log('DONE');
})()