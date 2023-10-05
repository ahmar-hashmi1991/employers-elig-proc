const AWS = require('aws-sdk-mock');
const { promisify } = require('util');
const db = require('../../../src/services/rds-data-service');
const employersFtpHandler = require('../../../src/handlers/employers-ftp-handler');
// const Readable = require('stream').Readable;

const ftp_info = {
  "server": {
    "host": "compute-1.amazonaws.com",
    "port": 22,
    "username": "ubuntu",
    "privateKey": "LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktL..."
  },
  "folder": "elig"
}

const EMPL_NO_PATTERN = {
  id: 1,
  ftp_info: JSON.stringify(ftp_info),
  folder: 'empl_folder',
  status: 'active',
  external_ftp: 1
};

const EMPL_WITH_PATTERN = {
  id: 1,
  ftp_info: JSON.stringify(ftp_info),
  folder: 'empl_folder',
  external_ftp: 1,
  status: 'active',
  file_name_filter: 'Event_Eligibility-\\d{4}-\\d{2}-\\d{2}-\\d+.csv'
}

describe('Test for employers-ftp-handler', () => {
  beforeAll(() => {
    AWS.mock('S3', 'getObject', { Body: {} });
    AWS.mock('S3', 'upload', { status: 'success' });

    //omit logging
    console.log = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Verifies sftp handler is processing files', async () => {
    db.getAllEmployers = jest.fn().mockResolvedValue([[EMPL_NO_PATTERN], []]);

    let readdir = jest.fn((path, cb) => cb(undefined, [
      {
        filename: 'eligibility.csv',
        longname: '-rw-rw-r--    1 ubuntu   ubuntu        479 Aug 25 12:00 eligibility.csv',
      }
    ]));
    let rename = jest.fn((srcPath, destPath, cb) => cb(undefined));
    employersFtpHandler.connetToFTP = jest.fn().mockResolvedValue({ readdir, rename });

    const spy = jest.spyOn(employersFtpHandler, 'processIncomingEligibilityFile').mockResolvedValue('');

    let result = await employersFtpHandler.employersFTPFileHandler({
      "bucket": "aws-us-east-1-dario-employers-elig-proc-employersbucket-stage"
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toBeCalledWith(
      expect.anything(),
      'elig',
      'eligibility.csv',
      expect.anything(),
      expect.anything()
    );

    spy.mockRestore();
  });

  it('Verifies sftp handler is NOT processing non .csv files', async () => {
    db.getAllEmployers = jest.fn().mockResolvedValue([[EMPL_NO_PATTERN], []]);
    let readdir = jest.fn((path, cb) => cb(undefined, [
      {
        filename: 'eligibility.csv.done',
        longname: '-rw-rw-r--    1 ubuntu   ubuntu        479 Aug 25 12:00 eligibility.csv.done',
      }
    ]));
    let rename = jest.fn((srcPath, destPath, cb) => cb(undefined));
    employersFtpHandler.connetToFTP = jest.fn().mockResolvedValue({ readdir, rename });

    const spy = jest.spyOn(employersFtpHandler, 'processIncomingEligibilityFile').mockResolvedValue('');

    let result = await employersFtpHandler.employersFTPFileHandler({
      "bucket": "aws-us-east-1-dario-employers-elig-proc-employersbucket-stage"
    });

    expect(spy).toHaveBeenCalledTimes(0);

    spy.mockRestore();
  })

  it('Verifies sftp handler is NOT processing file not matching pattern', async () => {
    db.getAllEmployers = jest.fn().mockResolvedValue([[EMPL_WITH_PATTERN], []]);
    let readdir = jest.fn((path, cb) => cb(undefined, [
      {
        filename: 'eligibility.csv',
        longname: '-rw-rw-r--    1 ubuntu   ubuntu        479 Aug 25 12:00 eligibility.csv',
      }
    ]));
    let rename = jest.fn((srcPath, destPath, cb) => cb(undefined));
    employersFtpHandler.connetToFTP = jest.fn().mockResolvedValue({ readdir, rename });

    const spy = jest.spyOn(employersFtpHandler, 'processIncomingEligibilityFile').mockResolvedValue('');

    let result = await employersFtpHandler.employersFTPFileHandler({
      "bucket": "aws-us-east-1-dario-employers-elig-proc-employersbucket-stage"
    });
    
    expect(spy).toHaveBeenCalledTimes(0);
    
    spy.mockRestore();
  });

  it('Verifies sftp handler is processing files matching pattern', async () => {
    db.getAllEmployers = jest.fn().mockResolvedValue([[EMPL_WITH_PATTERN], []]);
    let readdir = jest.fn((path, cb) => cb(undefined, [
      {
        filename: 'Event_Eligibility-2021-02-03-122607.csv.done',
        longname: '-rw-rw-r--    1 ubuntu   ubuntu        479 Aug 25 12:00 Event_Eligibility-2021-02-03-122607.csv.done',
      },
      {
        filename: 'Event_Eligibility-2021-02-03-122607.csv',
        longname: '-rw-rw-r--    1 ubuntu   ubuntu        479 Aug 25 12:00 Event_Eligibility-2021-02-03-122607.csv',
      }
    ]));
    let rename = jest.fn((srcPath, destPath, cb) => cb(undefined));
    employersFtpHandler.connetToFTP = jest.fn().mockResolvedValue({ readdir, rename });

    const spy = jest.spyOn(employersFtpHandler, 'processIncomingEligibilityFile').mockResolvedValue('');

    let result = await employersFtpHandler.employersFTPFileHandler({
      "bucket": "aws-us-east-1-dario-employers-elig-proc-employersbucket-stage"
    });
    
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toBeCalledWith(
      expect.anything(),
      'elig',
      'Event_Eligibility-2021-02-03-122607.csv',
      expect.anything(),
      expect.anything()
    );
    
    spy.mockRestore();
  });

  // it('Verifies that file processor is working', async () => {
  //     const mockStream = require('stream').Readable.from('file content');
  //     let s = new Readable({
  //         read(size) {
  //             return this.push(null);
  //         }
  //     });
  //     let sftp = {createReadStream: jest.fn(() => mockStream)};
  //     let result = await employersFtpHandler.processIncomingEligibilityFile(sftp, 'elig', 'file1.csv', 'bucket','s3folder');
  //     expect(result).toEqual('success');
  // })
})