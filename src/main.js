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

// Supabase helper - saves ALL extracted data
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
          // Basic info
          brand: item.brand,
          name: item.name,
          pattern: item.pattern,
          collection: item.collection,
          colorway: item.colorway,
          description: item.description,
          
          // Pricing
          pricing: {
            trade_price: item.tradePrice,
            retail_price: item.retailPrice,
            unit: item.priceUnit,
            price_text: item.priceText
          },
          
          // Media
          media: {
            primary_image_url: item.imageUrl,
            images: item.images
          },
          
          // All specifications (raw)
          specifications: item.specifications,
          
          // Structured tech details
          tech_details: {
            ...item.techDetails,
            width: item.specifications?.['Width'] || item.specifications?.['Fabric Width'] || item.techDetails?.width,
            repeat_vertical: item.specifications?.['Vertical Repeat'] || item.specifications?.['V. Repeat'],
            repeat_horizontal: item.specifications?.['Horizontal Repeat'] || item.specifications?.['H. Repeat'],
            content: item.specifications?.['Content'] || item.specifications?.['Fiber Content'] || item.specifications?.['Composition'],
            weight: item.specifications?.['Weight'] || item.specifications?.['Fabric Weight'],
            origin: item.specifications?.['Origin'] || item.specifications?.['Country of Origin'],
            finish: item.specifications?.['Finish'] || item.specifications?.['Treatment'],
            backing: item.specifications?.['Backing'],
            railroaded: item.specifications?.['Railroaded'] || item.specifications?.['Direction']
          },
          
          // Performance / durability data
          performance: {
            ...item.performanceData,
            abrasion: item.specifications?.['Abrasion'] || item.specifications?.['Wyzenbeek'] || item.specifications?.['Martindale'],
            pilling: item.specifications?.['Pilling'],
            colorfastness: item.specifications?.['Colorfastness'] || item.specifications?.['Lightfastness'],
            crocking: item.specifications?.['Crocking']
          },
          
          // Flammability / fire ratings
          flammability: item.flammability,
          
          // Certifications
          certifications: item.certifications,
          
          // Related products
          coordinates: item.coordinates,
          
          // Inventory
          inventory: {
            quantity: item.quantity,
            lead_time: item.leadTime,
            backorder: item.backorder
          },
          
          // Meta
          meta: {
            description: item.metaDescription,
            keywords: item.metaKeywords,
            canonical_url: item.canonicalUrl
          },
          
          // Raw structured data from page
          structured_data: item.structuredData
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
      
      // Extract ALL product data from PDP
      const product = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
        const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        const getAllText = (sel) => [...document.querySelectorAll(sel)].map(el => el.textContent?.trim()).filter(Boolean);
        
        // ===== BASIC INFO =====
        const sku = getText('.product-sku, .sku-value, [itemprop="sku"], .product-info-sku .value') ||
                   getText('.product-info-main .value') ||
                   window.location.pathname.split('/').pop();
        
        const name = getText('h1.page-title, h1.product-name, [itemprop="name"], .product-info-main h1');
        const brand = getText('.product-brand, .brand-name, [data-brand]') || '';
        const collection = getText('.product-collection, .collection-name, [data-collection]') || '';
        const pattern = getText('.product-pattern, .pattern-name, [data-pattern]') || '';
        
        // ===== PRICING =====
        const priceElements = document.querySelectorAll('.price, .product-price, [data-price-type], .price-box span');
        let tradePrice = null;
        let retailPrice = null;
        let priceText = '';
        let priceUnit = 'yard';
        
        priceElements.forEach(el => {
          const text = el.textContent || '';
          const priceMatch = text.match(/\$?([\d,]+\.?\d*)/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(',', ''));
            const lowerText = text.toLowerCase();
            if (lowerText.includes('trade') || lowerText.includes('net') || lowerText.includes('your price')) {
              tradePrice = price;
            } else if (lowerText.includes('retail') || lowerText.includes('list') || lowerText.includes('msrp')) {
              retailPrice = price;
            } else if (!tradePrice) {
              tradePrice = price;
            }
            priceText += text + ' ';
          }
        });
        
        // Price unit detection
        const unitMatch = priceText.match(/per\s+(yard|meter|roll|panel|each|repeat)/i);
        if (unitMatch) priceUnit = unitMatch[1].toLowerCase();
        
        // ===== IMAGES =====
        const primaryImage = getAttr('.product-image img, .gallery-placeholder img, [itemprop="image"], .fotorama__img, .product-media img', 'src') ||
                            getAttr('.product-image img, .gallery-placeholder img', 'data-src');
        
        const allImages = [...document.querySelectorAll('.product-image img, .gallery img, .fotorama__img, .product-media img, [data-gallery-role="gallery"] img')]
          .map(img => img.src || img.getAttribute('data-src') || img.getAttribute('data-full'))
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i); // unique
        
        // ===== ALL SPECIFICATIONS =====
        const specifications = {};
        const techDetails = {};
        const performanceData = {};
        
        // Table-based specs
        document.querySelectorAll('.product-attributes tr, .additional-attributes tr, .specs-table tr, .product-specs tr, table.data-table tr').forEach(row => {
          const key = row.querySelector('th, td:first-child, .label')?.textContent?.trim()?.replace(/:$/, '');
          const value = row.querySelector('td:last-child, td:nth-child(2), .value')?.textContent?.trim();
          if (key && value && key !== value) {
            specifications[key] = value;
          }
        });
        
        // List-based specs
        document.querySelectorAll('.product-attributes li, .specs-list li, .product-details li, dl.product-specs dt').forEach((el, i, list) => {
          if (el.tagName === 'DT') {
            const dd = el.nextElementSibling;
            if (dd?.tagName === 'DD') {
              specifications[el.textContent.trim()] = dd.textContent.trim();
            }
          } else {
            const text = el.textContent.trim();
            const colonSplit = text.split(':');
            if (colonSplit.length === 2) {
              specifications[colonSplit[0].trim()] = colonSplit[1].trim();
            }
          }
        });
        
        // ===== COMMON FABRIC ATTRIBUTES =====
        const attrSelectors = {
          width: '.width, [data-width], .product-width',
          repeat: '.repeat, [data-repeat], .pattern-repeat, .vertical-repeat, .horizontal-repeat',
          content: '.content, [data-content], .fiber-content, .composition',
          weight: '.weight, [data-weight], .fabric-weight',
          origin: '.origin, [data-origin], .country-origin',
          finish: '.finish, [data-finish], .fabric-finish',
          backing: '.backing, [data-backing]',
          railroaded: '.railroaded, [data-railroaded]',
          durability: '.durability, [data-durability], .abrasion, .double-rubs',
          flammability: '.flammability, [data-flammability], .fire-rating',
          cleaning: '.cleaning, [data-cleaning], .care-code, .cleaning-code',
          usage: '.usage, [data-usage], .application, .recommended-use'
        };
        
        for (const [key, sel] of Object.entries(attrSelectors)) {
          const val = getText(sel);
          if (val) techDetails[key] = val;
        }
        
        // ===== PERFORMANCE / TEST DATA =====
        const perfKeywords = ['abrasion', 'martindale', 'wyzenbeek', 'double rubs', 'pilling', 'colorfastness', 'lightfastness', 'crocking', 'seam slippage', 'tensile', 'tear strength'];
        for (const [key, val] of Object.entries(specifications)) {
          const lowerKey = key.toLowerCase();
          if (perfKeywords.some(kw => lowerKey.includes(kw))) {
            performanceData[key] = val;
          }
        }
        
        // ===== FLAMMABILITY =====
        const flammability = {};
        const flameKeywords = ['cal 117', 'cal tb', 'ufac', 'nfpa', 'bs 5852', 'imo', 'fmvss'];
        for (const [key, val] of Object.entries(specifications)) {
          const lowerKey = key.toLowerCase();
          if (flameKeywords.some(kw => lowerKey.includes(kw)) || lowerKey.includes('flame') || lowerKey.includes('fire')) {
            flammability[key] = val;
          }
        }
        
        // ===== CERTIFICATIONS =====
        const certifications = getAllText('.certification, .cert-badge, [data-certification], .eco-cert, .greenguard');
        
        // ===== AVAILABILITY =====
        const availText = getText('.stock, .availability, [data-availability], .product-availability').toLowerCase();
        const inStock = availText.includes('in stock') || availText.includes('available') || availText.includes('ships');
        const discontinued = availText.includes('discontinued') || availText.includes('retired');
        const backorder = availText.includes('backorder') || availText.includes('special order');
        const leadTime = getText('.lead-time, .ship-time, [data-lead-time]');
        
        // ===== INVENTORY =====
        const qtyText = getText('.qty-available, .inventory, [data-qty], .stock-qty');
        const qtyMatch = qtyText.match(/([\d,]+)\s*(yards?|meters?|rolls?)/i);
        const quantity = qtyMatch ? parseFloat(qtyMatch[1].replace(',', '')) : null;
        
        // ===== COLORWAY / COLOR =====
        const colorway = getText('.product-colorway, .color-name, [data-colorway], .color-value') || 
                        specifications['Color'] || 
                        specifications['Colorway'] ||
                        specifications['Color Name'] || '';
        
        // ===== RELATED PRODUCTS / COORDINATES =====
        const coordinates = getAllText('.coordinates a, .related-products a, .companion-products a')
          .map(t => t.trim()).filter(Boolean);
        
        // ===== DESCRIPTION =====
        const description = getText('.product-description, .description, [itemprop="description"], .product-info-description');
        
        // ===== META DATA =====
        const metaDescription = getAttr('meta[name="description"]', 'content');
        const metaKeywords = getAttr('meta[name="keywords"]', 'content');
        const canonicalUrl = getAttr('link[rel="canonical"]', 'href');
        
        // ===== STRUCTURED DATA =====
        let structuredData = {};
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (jsonLd) {
          try {
            structuredData = JSON.parse(jsonLd.textContent);
          } catch (e) {}
        }
        
        return {
          // Basic
          sku,
          name,
          brand,
          collection,
          pattern,
          colorway,
          description,
          
          // Pricing
          tradePrice,
          retailPrice,
          priceText: priceText.trim(),
          priceUnit,
          
          // Images
          primaryImage,
          images: allImages,
          
          // All specs
          specifications,
          techDetails,
          performanceData,
          flammability,
          certifications,
          
          // Availability
          inStock,
          discontinued,
          backorder,
          leadTime,
          quantity,
          
          // Related
          coordinates,
          
          // Meta
          metaDescription,
          metaKeywords,
          canonicalUrl,
          structuredData
        };
      });
      
      if (!product.sku) {
        log.warning('No SKU found, skipping');
        stats.errors++;
        return;
      }
      
      // Add URL and brand
      product.url = request.url;
      product.brand = BRANDS[brand]?.name || product.brand || brand;
      product.availability = {
        status: product.discontinued ? 'discontinued' : 
                product.backorder ? 'backorder' :
                product.inStock ? 'in_stock' : 'out_of_stock',
        quantity: product.quantity,
        leadTime: product.leadTime
      };
      
      // Use primaryImage as imageUrl for compatibility
      product.imageUrl = product.primaryImage;
      
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
