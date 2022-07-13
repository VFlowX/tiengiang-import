import XLSX, { WorkSheet } from 'xlsx';
import { getDanhMuc } from './danh_muc';
// import { getDanhMuc } from './danh_muc';

async function blindProcessXLSX(xlsxBuffer: any, cacheDanhMuc: string = 'false', database: string) {
  var workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
  let sheetData = await mapConfigSheet(workbook, cacheDanhMuc, database);


  return sheetData;
}

async function mapConfigSheet(worksheet: XLSX.WorkBook, cacheDanhMuc: string = 'false', database: string) {
  const _Sdata: any = {}
  const _Tdata: any = {}
  for (let sheet of worksheet.SheetNames.sort()) {
    // sort sheet by name to get ordered list C_ >> S_ >> T_

    if (sheet.startsWith("C_")) {
      // skip C_
      continue;
    }

    if (sheet.startsWith("S_")) {
      // Build S_
      _Sdata[sheet] = buildS_Data(worksheet.Sheets[sheet]);
      continue;
    }
    if (sheet == "T_TepDuLieu") {
      continue;
    }

    if (sheet.startsWith("T_")) {
      // build T_
      _Tdata[sheet] = await buildT_Data(worksheet.Sheets[sheet], _Sdata, cacheDanhMuc, database);
      if (_Tdata[sheet]) {
        for (let record of _Tdata[sheet]) {
          record
        }
      }
    }

    // for (let [index,] of data[sheet].entries()) {
    //   for (let column in config[sheet]) {
    //     const danhMucKey = config[sheet][column].Name;
    //     const collectionDanhMuc = config[sheet][column].DanhMuc;
    //     const valueXlsx = data[sheet][index][danhMucKey];
    //     if (danhMucData[collectionDanhMuc][valueXlsx]) {
    //       data[sheet][index][danhMucKey] = danhMucData[collectionDanhMuc][valueXlsx]
    //     }
    //     else {
    //       data[sheet][index][danhMucKey] = {
    //         _source: {
    //           [config[sheet][column].KeySearch]: valueXlsx
    //         }
    //       }
    //     }
    //   }
    // }
  }
  return _Tdata
}
function groupBy(xs: any[], key: string) {
  return xs.reduce((rv, x) => {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
};
function getHeaderRow(worksheet: any) {
  let headers = [];
  var range = XLSX.utils.decode_range(worksheet['!ref'] || '');
  var C = range.s.c;
  for (C = range.s.c; C <= range.e.c; ++C) {
    var cell = worksheet[XLSX.utils.encode_cell({ c: C, r: 0 })] /* find the cell in the first row */
    var hdr = "Cột không tên " + C; // <-- replace with your desired default 
    if (cell && cell.t) hdr = XLSX.utils.format_cell(cell);
    headers.push(hdr);
  }
  return headers;
}
function buildS_Data(worksheet: any) {
  const sheetData: any = XLSX.utils.sheet_to_json(worksheet);
  for (let index in sheetData) {
    for (let colName in sheetData[index]) {
      if (colName.startsWith("!")) {
        //Ignore column
        delete sheetData[index][colName];
        continue;
      }
    }
  }
  return groupBy(sheetData, getHeaderRow(worksheet)[0])
}
async function buildT_Data(worksheet: WorkSheet, arrData: any, cacheDanhMuc: string, database: string) {
  const sheetData: any = XLSX.utils.sheet_to_json(worksheet);
  const danhMucData: any = {};
  sheetData.splice(0, 1);

  for (let index in sheetData) {

    //sheetData[index] : 1 rowData
    for (let colName in sheetData[index]) {
      //
      // Case 1. Tên cột: "!..." => bỏ cả cột
      // 
      if (colName.startsWith("!")) {
        //Ignore column
        delete sheetData[index][colName];
        continue;
      }

      if (colName.indexOf("___") > -1) {
        // idTest*___S_ABC|S_XYZ(AAA)
        let [key, ...listConfig] = colName.split("___");

        if (key.endsWith("*")) {
          //
          // Case 2. ${fieldToCheck}*___${SheetName}(keyToSave)
          //   - *: đánh dấu cột lấy dữ liệu từ sheet khác
          //   - Tên Sheet: => phân cách bằng "|" 
          //   - Mặc định cột đầu trong các sheet con dùng để so sánh với cột fieldToCheck ở sheet cha
          //   - keyToSave: tên trường lưu thành mảng ở object sheet cha. Nếu không có sẽ lấy sheetName bỏ "S_". VD: S_HanNgachXaThai => HanNgachXaThai.
          // 
          if (listConfig[0].indexOf("|")) {
            for (let config of listConfig[0].split("|")) {
              let _SDataToGet = config; // S_ABC(XYZ)
              let keyToSave = key.replace("*", "");
              if (config.indexOf("(") > -1) {
                const filter = new RegExp(/(.+?)\((.+?)\)/gi);
                _SDataToGet = config.replace(filter, "$1"); // S_ABC
                keyToSave = config.replace(filter, "$2"); // XYZ
              }
              else {
                keyToSave = config.replace("S_", ""); // ABC
              }
              if (arrData[_SDataToGet]) {
                sheetData[index][keyToSave] = arrData[_SDataToGet][sheetData[index][colName]];
              }
            }
          }
          else {
            let _SDataToGet = listConfig[0]; // S_ABC(XYZ)
            let keyToSave = key.replace("*", "");
            if (listConfig[0].indexOf("(") > -1) {
              const filter = new RegExp(/(.+?)\((.+?)\)/gi);
              _SDataToGet = listConfig[0].replace(filter, "$1"); // S_ABC
              keyToSave = listConfig[0].replace(filter, "$2"); // XYZ
            }
            else {
              keyToSave = listConfig[0].replace("S_", ""); // ABC
            }
            if (arrData[_SDataToGet]) {
              sheetData[index][keyToSave] = arrData[_SDataToGet][sheetData[index][colName]];
            }
          }
          // clean up
          delete sheetData[index][colName];
        }
        else if (key.endsWith("[]")) {
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;

          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            let lstValue = sheetData[index][colName].split("||");
            let finalValue = [];
            for (let val of lstValue) {
              if (danhMucData[danhMuc][val]) {
                finalValue.push(danhMucData[danhMuc][val])
              }
              else {
                finalValue.push({
                  _source: {
                    [keySearch]: val
                  }
                })
              }
            }
            sheetData[index][keyToSave] = finalValue;
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
          delete sheetData[index][colName];
          // Danh mục nhiều dữ liệu tên cột key[] dữ liệu phân cách bởi ||
          // 3. ${Tên field}___${Tên danh mục}___${Key để tìm của danh mục}___${Key kèm theo phân cách bằng '|' }
          //   Mặc định MaMuc TenMuc có thể bỏ trống ${Tên field}___${Tên danh mục}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
        }
        else {
          // 3. ${Tên field}___${Tên danh mục}___${Key để tìm của danh mục}___${Key kèm theo phân cách bằng '|' }
          //   Mặc định MaMuc TenMuc có thể bỏ trống ${Tên field}___${Tên danh mục}
          // danhMucData[config[sheet][column].DanhMuc] = await getDanhMuc(database, config[sheet][column], cacheDanhMuc);
          let keyToSave = key.replace("[]", "");
          let [danhMuc, keySearch, keyToADD] = listConfig;
          //default value if not exist
          keySearch = keySearch || "TenMuc";
          keyToADD = keyToADD || "MaMuc";
          let config = {
            DanhMuc: danhMuc,
            KeySearch: keySearch,
            Fields: (keyToADD || "MaMuc").split("|"),
          }
          danhMucData[danhMuc] = danhMucData[danhMuc] || await getDanhMuc(database, config, cacheDanhMuc);
          if (danhMucData[danhMuc]) {
            if (danhMucData[danhMuc][sheetData[index][colName]]) {
              sheetData[index][keyToSave] = danhMucData[danhMuc][sheetData[index][colName]]
            }
            else {
              sheetData[index][keyToSave] = {
                _source: {
                  [keySearch]: sheetData[index][colName]
                }
              }
            }
            delete sheetData[index][colName];
          }
          else {
            return {
              status: "error",
              msg: `${danhMuc} not found!`
            }
          }
        }
      }
      else {
        // normal key text
        if (colName.endsWith("[]")) {
          let keyToSave = colName.replace("[]", "");
          sheetData[index][keyToSave] = sheetData[index][colName].split("||");
          delete sheetData[index][colName];
        }
      }
    }
  }
  // log(sheetData)
  return sheetData;
}

export { blindProcessXLSX }