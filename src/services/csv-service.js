const csv = require('csv-parser');
const stripBomStream = require('strip-bom-stream');
const papaParser = require('papaparse');
const { FixedWidthParser } = require('fixed-width-parser');
const logger = require('./log-service');

const DEFAULT_DELIMITER = ',';

const DEFAULT_VALUE_PROCESSOR = ({ header, index, value }) => {
    return isEmpty(value) ? null : value;
}

function isEmpty(val){
    if(!!!val) return true;
    if(val === '\u0000') return true;
    return false;
}

const parseCSV = (instream, delimiter = DEFAULT_DELIMITER, valueProcessor = DEFAULT_VALUE_PROCESSOR) => {
    return new Promise((resolve, reject) => {
        console.log('Start CSV parsing...... >>>');
        let results = [];
        instream.on('error', (error) => {
            console.log('ERROR in file stream ', error);
            reject(error.message);
        })
        .pipe(stripBomStream())
        .pipe(csv({
            separator: delimiter,
            mapValues: valueProcessor
        }))
        .on('data', (row) => {
            // console.log('ROW --> ', row);
            results.push(row);
        })
        .on('end', () => {
            console.log(`finished parsing ${results.length} rows from CSV file.`);
            resolve(results);
        })
        .on('error', (err) => {
            console.error('ERROR parsing file ', err);
            reject(err);
        });
    })
}

const ProcessCsvFile = (fileStream, chunkProcessor) => {
    return new Promise((resolve, reject) => {
        logger.info('Start CSV processing...... >>>');
        papaParser.parse(fileStream, {
            header: true,
            step: chunkProcessor,
            transformHeader: (h) => {
                return h.trim();
            },
            skipEmptyLines: true,
            transform: (val) => {
                return isEmpty(val) ? null : val;
            },
            complete: (results) => {
                logger.info(`complete parsing ${results ? results.length : '-NA-'} records of csv file`);
                resolve(results);
            },
            error: (err) => {
                logger.error('ERROR in csv processing', err);
                reject(err)
            }
        })
    })
}

const papaParseFile = (fileStream, parserConf) => {
    return new Promise((resolve, reject) => {
        console.log('Start CSV parsing by Papa parser...... >>>');
        let removeCharsObj = null;
        if(parserConf && parserConf.removeChars){
            removeCharsObj = removeChars(parserConf.removeChars);
            console.log('removeCharsObj', removeCharsObj)
        }
       papaParser.parse(fileStream, {
            header: true,
            transformHeader: (h) => {
                console.log(h);
                return h.trim();
            },
            skipEmptyLines: true,
            transform: (val, h) => {
                if(isEmpty(val)){
                    return null;
                }
                if(removeCharsObj && removeCharsObj[h]){
                    const regex = new RegExp(removeCharsObj[h], "g"); 
                    return val.replace(regex, '');
                }
                return val;
            },
            complete: (results) => {
                console.log(`complete parsing ${results.data.length} records of csv file`);
                if(parserConf && parserConf.removeLastRow && results.data){
                    let removedRow = results.data.splice(results.data.length -1)
                    console.log('papaParseFile-removedRow', removedRow, results.data.length)
                }
                
                resolve(results.data);
            },
            error: (err) => {
                console.error(err);
                reject(err)
            }
        })
    })
}

const papaUnParseFile = (json, config = {}) => {
    return new Promise((resolve, reject) => {
        console.log('Start CSV unparsing by Papa parser...... >>>');
        resolve(papaParser.unparse(json, config))
    })
}

function applyUsersRole(users, role) {
    if (!users[role]) {
        users[role] = {};
        users[role]['role'] = role;
    }

    return users;
}

function getMappedProperty(property, mappingByRole, role) {
    let newProp = property;
    if (mappingByRole) {
        newProp = mappingByRole[role].hasOwnProperty(property) ? mappingByRole[role][property] : '';
    }

    return newProp;
}

function getUsersWithMappedProperties(users, role, property, mappingByRole, unmappedRow) {
    users = applyUsersRole(users, role);
    const mappedProperty = getMappedProperty(property, mappingByRole, role);
    if (mappedProperty) {
        users[role][mappedProperty] = unmappedRow[property];
    }

    return users;
}

function removeChars(removeCharsString){
    const removeCharsObj = {};

    removeCharsString.split(',').reduce(
        (accumulator, currentValue) => {
            console.log('currentValue',currentValue)
            const split = currentValue.split('|')
            console.log('split', split[0], split[1])
            removeCharsObj[split[0]] = split[1];
            
        },removeCharsObj
    );

    console.log('removeCharsObj', removeCharsObj);
    return removeCharsObj;
}
// Vladislav Novitsky: there is better way to remove empty role earlier in "multilineDependentsParseFile", check and improve later
const removeEmptyRoles = (users, fieldForNullCheck) => {
    for (let role in users) {
        if (users[role][fieldForNullCheck] !== null) {
            continue;
        }
        delete users[role];
    }
    return users;
}

const multilineDependentsParseFile = async (fileStream, parserConf) => {
    try {
        const parsedFile = await papaParseFile(fileStream, parserConf);

        if (!parsedFile.length) {
            console.error('Empty file!');
            return;
        }

        const fileOutput = [];
        const roles = parserConf.startNewLine;
        const mappingByRole = parserConf.mappingByRole;
        const fieldForNullCheck = parserConf.fieldForNullCheck;

        for(const unmappedRow of parsedFile) {
            let users = {};
            for (let property in unmappedRow) {
                const index = roles.findIndex(el => property.includes(el))
                const role = index > -1 ? roles[index] : parserConf.firstRole;

                users = getUsersWithMappedProperties(users, role, property, mappingByRole, unmappedRow);
            }
            users = removeEmptyRoles(users, fieldForNullCheck);
            fileOutput.push(...Object.values(users));
        }

        return fileOutput;
    } catch (parsingError) {
        console.error('Parsing error!');
        console.log(parsingError);
        return;
    }
}

const fixedWidthParseFile = (fileStream, parserConf, fileStructureKey) => {
    return new Promise((resolve, reject) => {

        if(!parserConf){
            console.log("Missing employer's structure")
            reject("Missing employer's structure")
        }
        const fileStructure = fileStructureKey ? parserConf.file_structure[fileStructureKey] : parserConf.file_structure;
        let parserMap = generateParserMap(fileStructure)
        console.log('parserMap', parserMap)
        if(parserMap.error.length > 0 || parserMap.success.length < 1){
            console.log(`Missing employer's parser structure for parsing files with width fixed ${parserMap.error}`)
            reject(`Missing employer's parser structure for parsing files with width fixed ${parserMap.error}`)
        }
        let chunks = [];
        console.log('Start file parsing by fixedWidth parser...... >>>');
        fileStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        fileStream.on('error', (err) => reject(err));
        fileStream.on('end', () => {
            let stringData = Buffer.concat(chunks).toString('utf8')
            let aData = stringData.split('\n')
            if(parserConf.removeEmptyRow){
                aData = aData.filter(el => el.length > 0)
            }
            if(parserConf.startParseAtRow){
                aData.splice(0, parserConf.startParseAtRow)
            }
            if(parserConf.removeLastRow){
                aData.splice(aData.length -1)
            }
            stringData = aData.join('\n')
            const fixed = new FixedWidthParser(parserMap.success)
            const results = fixed.parse(stringData);
            console.log(results)
            console.log(`complete parsing ${results.length} records of csv file`);
            resolve(results)
        });

    })
}

function generateParserMap(fileStructure){
    let aMapper = {error: [], success: []};;
    for (const [key, record] of Object.entries(fileStructure)){
        if(fileStructure[key].width && fileStructure[key].start){
            aMapper.success.push({name: key, ...fileStructure[key]})
        } else {
             aMapper.error.push({name: key, message: "Missing width or start position"})
        }
    }
    return aMapper
}

module.exports = {
    parseCSV,
    papaParseFile,
    papaUnParseFile,
    fixedWidthParseFile,
    ProcessCsvFile,
    multilineDependentsParseFile
}
