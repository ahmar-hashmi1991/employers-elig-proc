const got = require('got');
const _ = require('lodash');
const decompress = require('decompress');
const braze = require('../services/braze-service');
const db = require('../services/rds-data-service');
const emailSrv = require('../services/email-service');
const constants = require('../common/constants');

const SEGMENT_ID = 'f8c3253b-5462-46a2-96c1-db1caeceb052';
const SEGMENT_ID_STAGE = '9d6372a9-7b95-49fd-be33-876fd107bc4c';

exports.cronHandler = async (event, context) => {
    console.log('event', JSON.stringify(event));
    let segmentId = process.env.STAGE === 'prod' ? SEGMENT_ID : SEGMENT_ID_STAGE;

    let [filehist] = await getFileHistory();
    if(filehist.length === 0){
        console.log('No new files since yesterday - nothing to analyze');
        await emailSrv.sendHtmlEmail(`Reconciliation Report`, `no new files since yesterday`);
    }
    else{
        let cb = `${process.env.CALLBACK_URL}/cb/braze/user/export`;
        let response = await braze.exportSegmentUsers(segmentId, cb);
        console.log('Braze response', response);
    }

    const result = {
        statusCode: 200,
        body: JSON.stringify({status: 'SUCCESS'})
    };
    return result;
}


exports.handleUsersExport = async (event, context) => {
    console.log('event', JSON.stringify(event));

    let body = JSON.parse(event.body);
    if(body.success){
        let [filehist] = await getFileHistory();
        console.log('file history result', filehist);

        if(filehist.length > 0){
            await generateReconciliationReport2(body.url, filehist);
        }
    }

    const result = {
        statusCode: 200,
        body: JSON.stringify({status: 'SUCCESS'})
    };
    return result;
}

exports.test = async (url, fileHistory) => {
    await generateReconciliationReport2(url, fileHistory);
}

async function generateReconciliationReport2(url, fileHistory) {
    console.log('file ready for download', url);
    let zipfile = await retrieveZipFile(url);
    let files = await decompress(zipfile);
    let brazeUsers = extractUsersFromFile(files);
    let brazeEmployersData = _.groupBy(brazeUsers, 'custom_attributes.b2b_employer_id');

    let reportView = {
        reportDate: new Date().toLocaleString(),
        employers: []
    };
    for(let hist of fileHistory){
        let [employer] = await db.getEmployerByID(hist.employer_id);
        if(employer.length === 1){
            let brazeNewData = brazeEmployersData[employer[0].external_id];
            let brazeNewCouters = _.countBy(brazeNewData, 'custom_attributes.b2b_eligibility_status');
            let brazeLastCouters = JSON.parse(employer[0].braze_stats);
            //add record
            let jobdata = JSON.parse(hist.output);
            reportView.employers.push({
                employer: `${employer[0].name} (${employer[0].external_id})`,
                file: hist.file_name,
                last: brazeLastCouters, 
                new: brazeNewCouters,
                process: jobdata});
            
            await db.updateFileHistoryLog(hist.id, {status: constants.FileLogStatus.SUCCESS_RECON});
        }
    }
    console.log(JSON.stringify(reportView,null,2));
    await emailSrv.sendTemplateEmail(`Reconciliation Report`, reportView, 'reconciliation');

    let brazeEmployers = Object.keys(brazeEmployersData);
    for(let emp_ext_id of brazeEmployers){
        console.log(`handling employer ${emp_ext_id}`);
        let [e] = await db.getEmployer(emp_ext_id);
        if(e.length === 1){
            console.log(`updating braze ststus for employer ${emp_ext_id}`);
            let counters = _.countBy(brazeEmployersData[emp_ext_id], 'custom_attributes.b2b_eligibility_status');
            await db.updateEmployerBrazeStats(e[0].id, JSON.stringify(counters));
        }
    }
}

function getFileHistory(){
    let startDt = new Date();
    startDt.setDate(startDt.getDate()-1);
    startDt.setHours(0,0,0,0);
    console.log(`searching for new eligibility files procesing since ${startDt.toLocaleString()} UTC`);
    return db.searchFileHistoryLog(startDt);
}

function retrieveZipFile(url){
    let downloadStream = got.stream(url);
    downloadStream
        .on("downloadProgress", ({ transferred, total, percent }) => {
            const percentage = Math.round(percent * 100);
            console.log(`users file progress: ${transferred}/${total} (${percentage}%)`);
        })
        .on("error", (error) => {
            console.error(`Download failed: ${error.message}`, error);
        });
    return streamToBuffer(downloadStream);
}

function extractUsersFromFile(files){
    let records = [];
    for(let file of files){
        // console.log('file --> ', file);
        if(file.type === 'file'){
            let data = file.data.toString();
            let rows = data.split(/\r?\n/).reduce((arr,r) => {
                try{
                    if(r.trim().length) arr.push(JSON.parse(r));
                }
                catch(err){
                    console.log(`failed to parse '${r}' ${r.length}`, err.message);
                }
                return arr;
            }, []);
            records = records.concat(rows);
            console.log(`${file.path} records -> `, rows.length);
        }
    }
    console.log(`total of -> ${records.length} records`);
    return records;
}

async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const data = [];
        stream.on('data', (chunk) => {
            data.push(Buffer.from(chunk));
        });
        stream.on('end', () => {
            resolve(Buffer.concat(data))
        })
        stream.on('error', (err) => {
            reject(err)
        })
    })
}
