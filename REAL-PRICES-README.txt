V34 REAL MARKET PRICES

1. Upload the project ROOT to Cloudflare Pages.
2. The included _worker.js automatically creates /api/prices.
3. No Skinport Client ID or Secret is required: it uses the public sales/history endpoint.
4. Clear the old browser price cache once with Ctrl+F5. The cache key was changed to v34.
5. The catalog now hides items without a real market price. Fake/reserve catalog prices are disabled.

If Cloudflare is configured with the output directory "public", upload/deploy that directory: it also contains _worker.js.
