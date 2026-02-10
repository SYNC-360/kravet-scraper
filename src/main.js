/**
 * Kravet Fabrics Scraper v1.0
 * Scrapes all 6 Kravet brands with trade account pricing
 * Saves directly to Supabase
 * 
 * Brands: Kravet, Lee Jofa, Brunschwig & Fils, GP & J Baker, Andrew Martin, Cole & Son
 */

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Kravet brand configurations
const BRANDS = {
  kravet: {
    name: 'Kravet',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric'
  },
  leejofa: {
    name: 'Lee Jofa',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric?brand=Lee+Jofa'
  },
  brunschwig: {
    name: 'Brunschwig & Fils',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric?brand=Brunschwig+%26+Fils'
  },
  gpjbaker: {
    name: 'GP & J Baker',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric?brand=GP+%26+J+Baker'
  },
  andrewmartin: {
    name: 'Andrew Martin',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric?brand=Andrew+Martin'
  },
  coleson: {
    name: 'Cole & Son',
    baseUrl: 'https://www.kravet.com',
    shopUrl: 'https://www.kravet.com/shop/fabric?brand=Cole+%26+Son'
  }
};

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
  email = 'lab101@gmail.com',
  password = 'Lucky!977',
  brands = ['kravet'], // Which brands to scrape
  maxProductsPerBrand = 10000,
  maxConcurrency = 2,
  supabaseUrl,
  supabaseKey,
  skipSupabase = false
} = input;

console.log('🚀 Kravet Scraper v1.0');
console.log(`📧 Login: ${email}`);
console.log(`🏷️ Brands: ${brands.join(', ')}`);
console.log(`📊 Max products/brand: ${maxProductsPerBrand}`);
console.log(`💾 Supabase: ${skipSupabase ? 'DISABLED' : 'ENABLED'}`);

// Stats tracking
const stats = {
  productsScraped: 0,
  productsSaved: 0,
  errors: 0,
  byBrand: {}
};

brands.forEach(b => stats.byBrand[b] = { scraped: 0, saved: 0 });

// Supabase helper
async function saveToSupabase(item) {
  if (skipSupabase || !supabaseUrl || !supabaseKey) {
    return false;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/item_latest`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        vendor_item_id: item.sku,
        item_url: item.url,
        price_value: item.tradePrice,
        price_text: item.priceText,
        availability: item.availability,
        discontinued: item.discontinued || false,
        data: {
          brand: item.brand,
          name: item.name,
          collection: item.collection,
          colorway: item.colorway,
          pricing: {
            trade_price: item.tradePrice,
            retail_price: item.retailPrice,
            unit: item.priceUnit
          },
          media: {
            primary_image_url: item.imageUrl,
            images: item.images
          },
          specifications: item.specifications,
          tech_details: item.techDetails
        }
      })
    });

    return response.ok;
  } catch (err) {
    console.error(`❌ Supabase error for ${item.sku}: ${err.message}`);
    return false;
  }
}

// HTTP login to get session cookies
async function loginWithHttp() {
  console.log('🔐 Logging in via HTTP...');
  
  try {
    // First, get the login page to get any CSRF tokens
    const loginPageRes = await fetch('https://www.kravet.com/customer/account/login/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const cookies = loginPageRes.headers.get('set-cookie') || '';
    
    // Extract form key if present
    const loginPageHtml = await loginPageRes.text();
    const formKeyMatch = loginPageHtml.match(/name="form_key"\s+value="([^"]+)"/);
    const formKey = formKeyMatch ? formKeyMatch[1] : '';
    
    // Submit login
    const loginRes = await fetch('https://www.kravet.com/customer/account/loginPost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({
        'form_key': formKey,
        'login[username]': email,
        'login[password]': password,
        'send': ''
      }),
      redirect: 'manual'
    });
    
    // Get session cookies from response
    const sessionCookies = loginRes.headers.get('set-cookie') || '';
    
    if (sessionCookies.includes('PHPSESSID') || loginRes.status === 302) {
      console.log('✅ HTTP login successful');
      return sessionCookies;
    } else {
      console.log('⚠️ HTTP login may have failed, will try browser login');
      return null;
    }
  } catch (err) {
    console.error('❌ HTTP login error:', err.message);
    return null;
  }
}

// Main crawler
const crawler = new PlaywrightCrawler({
  maxConcurrency,
  navigationTimeoutSecs: 120,
  requestHandlerTimeoutSecs: 300,
  
  async requestHandler({ request, page, enqueueLinks, log }) {
    const { label, brand } = request.userData;
    
    if (label === 'LOGIN') {
      log.info('🔐 Browser login...');
      
      // Fill login form
      await page.fill('input[name="login[username]"]', email);
      await page.fill('input[name="login[password]"]', password);
      await page.click('button[type="submit"], button.login');
      
      await page.waitForTimeout(3000);
      
      // Check if logged in
      const accountLink = await page.$('a[href*="account"], .customer-welcome');
      if (accountLink) {
        log.info('✅ Logged in successfully');
      } else {
        log.warning('⚠️ Login may have failed');
      }
      
      // Queue brand listing pages
      for (const brandKey of brands) {
        const brandConfig = BRANDS[brandKey];
        if (brandConfig) {
          await crawler.addRequests([{
            url: brandConfig.shopUrl,
            label: 'LISTING',
            userData: { brand: brandKey, page: 1 }
          }]);
        }
      }
      return;
    }
    
    if (label === 'LISTING') {
      log.info(`📋 Listing page: ${brand} (page ${request.userData.page || 1})`);
      
      // Wait for products to load
      await page.waitForSelector('.product-item, .product-card, [data-product-id]', { timeout: 30000 }).catch(() => {});
      
      // Get product links
      const productLinks = await page.$$eval(
        'a.product-item-link, a.product-card-link, .product-item a[href*="/product/"], .product-name a',
        links => links.map(a => a.href).filter(h => h.includes('/product/') || h.includes('/fabric/'))
      );
      
      log.info(`Found ${productLinks.length} products on page`);
      
      // Queue product pages
      for (const url of productLinks.slice(0, maxProductsPerBrand)) {
        await crawler.addRequests([{
          url,
          label: 'PRODUCT',
          userData: { brand }
        }]);
      }
      
      // Check for next page
      const nextPageLink = await page.$('a.next, a[rel="next"], .pages-item-next a');
      if (nextPageLink && stats.byBrand[brand].scraped < maxProductsPerBrand) {
        const nextUrl = await nextPageLink.getAttribute('href');
        if (nextUrl) {
          await crawler.addRequests([{
            url: nextUrl.startsWith('http') ? nextUrl : `https://www.kravet.com${nextUrl}`,
            label: 'LISTING',
            userData: { brand, page: (request.userData.page || 1) + 1 }
          }]);
        }
      }
      return;
    }
    
    if (label === 'PRODUCT') {
      log.info(`📦 Product: ${request.url}`);
      
      await page.waitForTimeout(1000);
      
      // Extract product data
      const product = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
        const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        
        // SKU
        const sku = getText('.product-sku, .sku-value, [itemprop="sku"]') ||
                   getText('.product-info-main .value') ||
                   window.location.pathname.split('/').pop();
        
        // Name
        const name = getText('h1.page-title, h1.product-name, [itemprop="name"]');
        
        // Brand
        const brand = getText('.product-brand, .brand-name') || '';
        
        // Collection
        const collection = getText('.product-collection, .collection-name') || '';
        
        // Prices - look for trade vs retail
        const priceElements = document.querySelectorAll('.price, .product-price, [data-price-type]');
        let tradePrice = null;
        let retailPrice = null;
        let priceText = '';
        
        priceElements.forEach(el => {
          const text = el.textContent || '';
          const priceMatch = text.match(/\$?([\d,]+\.?\d*)/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(',', ''));
            if (text.toLowerCase().includes('trade') || text.toLowerCase().includes('net')) {
              tradePrice = price;
            } else if (text.toLowerCase().includes('retail') || text.toLowerCase().includes('list')) {
              retailPrice = price;
            } else if (!tradePrice) {
              tradePrice = price; // Default to first price as trade
            }
            priceText = text;
          }
        });
        
        // Price unit
        const priceUnit = priceText.match(/per\s+(\w+)/i)?.[1] || 'yard';
        
        // Image
        const imageUrl = getAttr('.product-image img, .gallery-placeholder img, [itemprop="image"]', 'src') ||
                        getAttr('.fotorama__img', 'src');
        
        // All images
        const images = [...document.querySelectorAll('.product-image img, .gallery img, .fotorama__img')]
          .map(img => img.src || img.getAttribute('data-src'))
          .filter(Boolean);
        
        // Specifications
        const specifications = {};
        document.querySelectorAll('.product-attributes tr, .additional-attributes tr, .specs-table tr').forEach(row => {
          const key = row.querySelector('th, td:first-child')?.textContent?.trim();
          const value = row.querySelector('td:last-child, td:nth-child(2)')?.textContent?.trim();
          if (key && value) {
            specifications[key] = value;
          }
        });
        
        // Availability
        const availText = getText('.stock, .availability, [data-availability]').toLowerCase();
        const inStock = availText.includes('in stock') || availText.includes('available');
        const discontinued = availText.includes('discontinued');
        
        // Colorway
        const colorway = getText('.product-colorway, .color-name') || 
                        specifications['Color'] || 
                        specifications['Colorway'] || '';
        
        return {
          sku,
          name,
          brand,
          collection,
          colorway,
          tradePrice,
          retailPrice,
          priceText,
          priceUnit,
          imageUrl,
          images,
          specifications,
          inStock,
          discontinued
        };
      });
      
      if (!product.sku) {
        log.warning('No SKU found, skipping');
        stats.errors++;
        return;
      }
      
      // Add URL and brand
      product.url = request.url;
      product.brand = BRANDS[brand]?.name || brand;
      product.availability = {
        status: product.discontinued ? 'discontinued' : (product.inStock ? 'in_stock' : 'out_of_stock')
      };
      
      // Save to dataset
      await Actor.pushData(product);
      stats.productsScraped++;
      stats.byBrand[brand].scraped++;
      
      // Save to Supabase
      const saved = await saveToSupabase(product);
      if (saved) {
        stats.productsSaved++;
        stats.byBrand[brand].saved++;
      }
      
      log.info(`✅ ${product.sku}: $${product.tradePrice || 'N/A'} (${product.brand})`);
    }
  },
  
  async failedRequestHandler({ request, error, log }) {
    log.error(`❌ Failed: ${request.url} - ${error.message}`);
    stats.errors++;
  }
});

// Start with login
console.log('🏁 Starting Kravet scraper...');

// Try HTTP login first
const sessionCookies = await loginWithHttp();

if (sessionCookies) {
  // If HTTP login worked, go straight to listing pages
  const startRequests = brands.map(brandKey => ({
    url: BRANDS[brandKey]?.shopUrl || BRANDS.kravet.shopUrl,
    label: 'LISTING',
    userData: { brand: brandKey, page: 1 }
  }));
  await crawler.run(startRequests);
} else {
  // Fall back to browser login
  await crawler.run([{
    url: 'https://www.kravet.com/customer/account/login/',
    label: 'LOGIN',
    userData: {}
  }]);
}

// Final stats
console.log('\n═══════════════════════════════════════');
console.log('  KRAVET SCRAPER COMPLETE');
console.log('═══════════════════════════════════════');
console.log(`📊 Total scraped: ${stats.productsScraped}`);
console.log(`💾 Saved to Supabase: ${stats.productsSaved}`);
console.log(`❌ Errors: ${stats.errors}`);
console.log('\n📦 By Brand:');
for (const [brand, data] of Object.entries(stats.byBrand)) {
  console.log(`   ${BRANDS[brand]?.name || brand}: ${data.scraped} scraped, ${data.saved} saved`);
}

await Actor.exit();
