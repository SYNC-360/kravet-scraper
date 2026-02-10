# Kravet Fabrics Scraper

Scrapes all 6 Kravet brands with trade account pricing and saves to Supabase.

## Brands Supported
- Kravet
- Lee Jofa
- Brunschwig & Fils
- GP & J Baker
- Andrew Martin
- Cole & Son

## Features
- Trade account login (HTTP + browser fallback)
- Multi-brand scraping in single run
- Direct Supabase integration
- Price extraction (trade + retail)
- Full product specifications
- Image URLs
- Availability status

## Usage

### Local Testing
```bash
npm install
npm start
```

### Apify Deployment
```bash
apify push
```

### Input Example
```json
{
  "email": "your@email.com",
  "password": "yourpassword",
  "brands": ["kravet", "leejofa"],
  "maxProductsPerBrand": 5000,
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseKey": "your-service-role-key"
}
```

## Output Schema
Each product includes:
- `sku` - Product SKU
- `name` - Product name
- `brand` - Brand name (Kravet, Lee Jofa, etc.)
- `collection` - Collection name
- `colorway` - Color/colorway
- `tradePrice` - Trade account price
- `retailPrice` - Retail/list price
- `imageUrl` - Primary image
- `specifications` - Full specs object
- `availability` - Stock status

## Pricing Formula
For bestupholsteryfabric.com:
- Sale = Trade price (what we pay)
- Regular (crossed-out) = Sale × 1.30
