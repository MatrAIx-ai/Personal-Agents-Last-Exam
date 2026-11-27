'use strict';
const destinations = ['CA','MX','FR','DE','JP','KR'];
// Prices in USD cents, data in decimal megabytes, roaming per line per UTC month.
const plans = [
  {id:'basic', price:4500, domestic_mb:10000, hotspot_mb:1000, roaming_mb:0, coverage:[]},
  {id:'family', price:7000, domestic_mb:30000, hotspot_mb:5000, roaming_mb:500, coverage:['CA','MX']},
  {id:'global', price:9500, domestic_mb:60000, hotspot_mb:12000, roaming_mb:2000, coverage:destinations}
];
const products = [
  {id:'regional', price:1200, days:3, data_mb:1500, coverage:['CA','MX','FR','DE']},
  {id:'world', price:2800, days:7, data_mb:5000, coverage:destinations}
];
module.exports = {plans, products, destinations};
