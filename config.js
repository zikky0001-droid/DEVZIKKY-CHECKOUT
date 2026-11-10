// DEVZIKKY PAY — server-side application configuration.
// This file must NEVER be imported by browser code or placed inside /public.

export const APP_CONFIG = {
  API_EMAIL: "zikkystar0001@gmail.com",
  DEFAULT_CURRENCY: "NGN",
  RETENTION_YEARS: 3,
  RATE_SOURCE_URL: "https://theratesapi.com/api/latest?base=NGN",
  RATE_MAX_AGE_DAYS: 5,
  RATE_REFRESH_MINUTES: 60,
  RATE_TIMEOUT_MS: 15000,
  // Reference backup supplied by the project owner
  // Backup rates are available for the original 33 currencies only.
  STATIC_BACKUP_DATE: "2026-11-09",
STATIC_BACKUP_NGN_PER_UNIT: {
  NGN: 1,
  USD: 1346.24,
  GBP: 1798.91,
  EUR: 1500.96,
  INR: 14.3145,
  CAD: 953.7425,
  AUD: 924.7272,
  ZAR: 81.4206,
  GHS: 115.54,
  KES: 10.32,
  AED: 366.5689,
  SAR: 358.999,
  CNY: 201.5392,
  JPY: 8.5027,
  CHF: 1642.41,
  SGD: 1049.38,
  NZD: 748.11,
  PKR: 4.8641,
  PHP: 21.3343,
  BRL: 244.565,
  KWD: 4344.24,
  IDR: 0.07449,
  MYR: 331.69,
  KRW: 0.9920,
  THB: 40.215,
  VND: 0.05265,
  MXN: 72.26,
  TRY: 26.876,
  EGP: 24.9167,
  HKD: 172.08,
  QAR: 369.85,
  BDT: 10.8465,
  TWD: 41.0157
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


