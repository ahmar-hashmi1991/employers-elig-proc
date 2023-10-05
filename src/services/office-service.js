const XlsxPopulate = require('xlsx-populate');

const generateExcelDoc = async (csv, delimiter, password) => {
    let workbook = await XlsxPopulate.fromBlankAsync();
    let rows = csv.split('\n');
    for(const [r, row] of rows.entries()){
        let columns = row.split(delimiter);
        for(const [c, col] of columns.entries()){
            workbook.sheet("Sheet1").row(r+1).cell(c+1).value(col);
        }
    }

    let base64 = await workbook.outputAsync({ password: password });
    return base64;
}

module.exports = {
    generateExcelDoc
}