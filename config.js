// DEVZIKKY PAY — server-side application configuration.
// This file must NEVER be imported by browser code or placed inside /public.
export const APP_CONFIG = {
  API_EMAIL: "zikkystar0001@gmail.com",
  DEFAULT_CURRENCY: "NGN",
  RETENTION_YEARS: 3,
  RATE_SOURCE_URL: "https://theratesapi.com/api/latest?base=NGN",
  RATE_MAX_AGE_DAYS: 5,
  RATE_REFRESH_MINUTES: 60,
  RATE_TIMEOUT_MS: 8000,
  // Reference backup supplied by the project owner (snapshot: 2026-11-06).
  // Backup rates are available for the original 33 currencies only.
  STATIC_BACKUP_DATE: "2026-11-06",
  STATIC_BACKUP_NGN_PER_UNIT: {
    NGN: 1, USD: 1348.739535, GBP: 1805.272479, EUR: 1505.867613,
    INR: 14.360182, CAD: 958.772771, AUD: 926.784059, ZAR: 81.552765,
    GHS: 115.566855, KES: 10.380982, AED: 367.242012, SAR: 359.712230,
    CNY: 202.183583, JPY: 8.518831, CHF: 1647.446458, SGD: 1052.631579,
    NZD: 747.384155, PKR: 4.871348, PHP: 21.402735, BRL: 245.037981,
    KWD: 4366.812227, IDR: 0.0745149875, MYR: 332.28221393,
    KRW: 0.9926484456, THB: 40.2003585872, VND: 0.0526030736,
    MXN: 72.1105310220, TRY: 26.8925642060, EGP: 25.0312264550,
    HKD: 172.0894934202, QAR: 370.5295608484, BDT: 10.8476341310,
    TWD: 40.9601048579
  }
};

export const PRICING_CURRENCIES = [
  ["NGN","Nigerian Naira","₦","🇳🇬",0],["USD","US Dollar","$","🇺🇸",2],
  ["GBP","British Pound","£","🇬🇧",2],["EUR","Euro","€","🇪🇺",2],
  ["INR","Indian Rupee","₹","🇮🇳",2],["CAD","Canadian Dollar","C$","🇨🇦",2],
  ["AUD","Australian Dollar","A$","🇦🇺",2],["ZAR","South African Rand","R","🇿🇦",2],
  ["GHS","Ghanaian Cedi","GH₵","🇬🇭",2],["KES","Kenyan Shilling","KSh","🇰🇪",2],
  ["AED","UAE Dirham","د.إ","🇦🇪",2],["SAR","Saudi Riyal","ر.س","🇸🇦",2],
  ["CNY","Chinese Yuan","¥","🇨🇳",2],["JPY","Japanese Yen","¥","🇯🇵",0],
  ["CHF","Swiss Franc","CHF ","🇨🇭",2],["SGD","Singapore Dollar","S$","🇸🇬",2],
  ["NZD","New Zealand Dollar","NZ$","🇳🇿",2],["PKR","Pakistani Rupee","₨","🇵🇰",2],
  ["PHP","Philippine Peso","₱","🇵🇭",2],["BRL","Brazilian Real","R$","🇧🇷",2],
  ["KWD","Kuwaiti Dinar","KD ","🇰🇼",3],["IDR","Indonesian Rupiah","Rp","🇮🇩",0],
  ["MYR","Malaysian Ringgit","RM","🇲🇾",2],["KRW","South Korean Won","₩","🇰🇷",0],
  ["THB","Thai Baht","฿","🇹🇭",2],["VND","Vietnamese Dong","₫","🇻🇳",0],
  ["MXN","Mexican Peso","MX$","🇲🇽",2],["TRY","Turkish Lira","₺","🇹🇷",2],
  ["EGP","Egyptian Pound","E£","🇪🇬",2],["HKD","Hong Kong Dollar","HK$","🇭🇰",2],
  ["QAR","Qatari Riyal","ر.ق","🇶🇦",2],["BDT","Bangladeshi Taka","৳","🇧🇩",2],
  ["TWD","New Taiwan Dollar","NT$","🇹🇼",2],
  ["NOK","Norwegian Krone","kr","🇳🇴",2],["SEK","Swedish Krona","kr","🇸🇪",2],
  ["DKK","Danish Krone","kr","🇩🇰",2],["PLN","Polish Złoty","zł","🇵🇱",2],
  ["CZK","Czech Koruna","Kč","🇨🇿",2],["HUF","Hungarian Forint","Ft","🇭🇺",2],
  ["RON","Romanian Leu","lei","🇷🇴",2],["ILS","Israeli New Shekel","₪","🇮🇱",2],
  ["BHD","Bahraini Dinar","BD ","🇧🇭",3],["OMR","Omani Rial","ر.ع.","🇴🇲",3],
  ["MAD","Moroccan Dirham","د.م.","🇲🇦",2],["LKR","Sri Lankan Rupee","Rs","🇱🇰",2],
  ["NPR","Nepalese Rupee","रू","🇳🇵",2],["UGX","Ugandan Shilling","USh","🇺🇬",0],
  ["TZS","Tanzanian Shilling","TSh","🇹🇿",0],["XOF","West African CFA Franc","CFA","🌍",0],
  ["XAF","Central African CFA Franc","FCFA","🌍",0],["CLP","Chilean Peso","$","🇨🇱",0]
];
// De-duplicate by code defensively; the intended supported count is 51.
export const CURRENCIES = [...new Map(PRICING_CURRENCIES.map(([code,name,symbol,flag,digits]) =>
  [code,{code,name,symbol,flag,digits}])).values()];
