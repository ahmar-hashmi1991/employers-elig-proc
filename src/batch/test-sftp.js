const Client = require('ssh2').Client;
const { promisify } = require('util');

const connetToFTP = (connection) => {
    return new Promise((resolve, reject) => {
        let conn = new Client();
        conn.on('ready', function () {
            console.log('Client :: ready');
            conn.sftp(function (err, sftp) {
                if (err) reject(err);
                resolve(sftp);
            });
        }).connect(connection);
    })
}


(async () => {
    console.log("START");
    let file_name_filter = 'Event_Eligibility-\\d{4}-\\d{2}-\\d{2}-\\d+.csv';
    let folder = '/Emerson Climate Technologies/Eligibility/FromTVG';

    let sftp = await connetToFTP({
        host: '',
        port: 22,
        username: '',
        password: '',
        algorithms: {
            serverHostKey: ['ssh-rsa', 'ssh-dss']
        }
    });

    let files = await promisify(sftp.readdir).bind(sftp)(folder);
    console.log('ftp files: ', files);
    files = files.filter(f => f.filename.match(new RegExp(file_name_filter)) && !f.filename.endsWith('.done'));
    console.log('ftp files after filter: ', files);
    
    // await promisify(sftp.mkdir).bind(sftp)(`${folder}/processed`);
    // console.log('after mkdir...');

    // await promisify(sftp.rename).bind(sftp)(`${folder}/${'Event_Eligibility-2021-01-15-122607.csv.done'}`, `${folder}/${'Event_Eligibility-2021-01-15-122607.csv.done'}.done`);
    // console.log('after rename...');

    console.log("END");
})();