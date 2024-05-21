// nyontek dari createMdFilesFromGhost.js

const GhostContentAPI = require('@tryghost/content-api');
const yaml = require('js-yaml');
const fs = require('fs-extra');
const path = require('path');
const TurndownService = require('turndown');
const TurndownPluginGfm = require('@guyplusplus/turndown-plugin-gfm');
const axios = require('axios');
const sharp = require('sharp');

// ghost content api
const api = new GhostContentAPI({
    // url: 'https://demo.ghost.io', // replace with your Ghost API URL
    // key: '22444f78447824223cefc48062', // replace with your API key
    // content api tidak terlalu 'privat', jadi tidak masalah meski di push
    url: 'https://ttrphy-blog.fly.dev',
    key: '29c30834279893cc372eb30a69',
    version: "v5.0" // minimum Ghost version
});

// turndown html ke markdown
const turndownService = new TurndownService({
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
    hr: '---'
});

// embed youtube dari ghost
turndownService.addRule('youtubeIFrame', {
  filter:  function (node, options) {
    return (node.nodeName == 'IFRAME')&&(/youtube/ig.test(node.getAttribute('src')));
  },
  replacement: function (content, node, options) {
    let src = node.getAttribute('src');
    // split khusus youtube embed
    let videoId = src.split('/').pop().split('?')[0];
    return `\n\n{{< youtube ${videoId} >}}\n\n`;
  }
});

// callout, TODO: ambil icon dari kg-callout-emoji, proses markdown
turndownService.addRule('callout-emoji', {
  filter:  function (node, options) {
    return (node.nodeName == 'DIV')&&(/kg-callout-emoji/ig.test(node.getAttribute('class')));
  },
  replacement: function () {
    return '';
  }
});
turndownService.addRule('callout', {
  filter:  function (node, options) {
    return (node.nodeName == 'DIV')&&(/kg-callout-text/ig.test(node.getAttribute('class')));
  },
  replacement: function (content) {
    return `\n\n{{< callout text="${content}" >}}\n\n`;
  }
});
// caption
turndownService.addRule('figcaption', {
  filter:  'figcaption',
  replacement: function (content, node) {
    // caption untuk kode terdapat <p> dan <span>, jadi perlu dihapus
    // sedangkan caption untuk gambar tidak ada, jadi masih aman
    content = node.textContent;
    return `\n\n{{< figcaption text="${content}" >}}\n\n`;
  }
});

// tambah plugin turndown untuk tabel
turndownService.use(TurndownPluginGfm.gfm);

const generateContent = async () => {

    console.time('All posts converted to Markdown in');

    try {
        // fetch the posts from the Ghost Content API
        const posts = await api.posts.browse({
            limit: 'all',
            include: 'tags,authors',
            formats: ['html'],
        });

        // ambil teks
        await Promise.all(posts.map(async (post) => {
            // Save the content separate and delete it from our post object, as we'll create
            // the frontmatter properties for every property that is left
            const content = turndownService.turndown(post.html);
            delete post.html;

            // sesuaikan frontmatter dengan tema papermod
            const frontmatter = {
                title: post.meta_title || post.title,
                summary: post.meta_description || post.excerpt,
                description: post.meta_description || post.excerpt,
                date: post.published_at,
                author: post.authors[0].name,
                cover: {
                    image: 'cover.webp',
                    caption: post.feature_image_caption
                },
                weight: post.featured ? 1 : 0,
                draft: post.visibility !== 'public',
            };

            if (post.tags && post.tags.length) {
                frontmatter.categories = post.tags.map(t => t.name);
            }

            // There should be at least one author.
            if (!post.authors || !post.authors.length) {
                return;
            }

            // If there's a canonical url, please add it.
            if (post.canonical_url) {
                frontmatter.canonicalURL = post.canonical_url;
            }

            // Create frontmatter properties from all keys in our post object
            const yamlPost = await yaml.dump(frontmatter);

            // Super simple concatenating of the frontmatter and our content
            const fileString = `---\n${yamlPost}\n---\n${content}\n`;

            // ikut format PageBundles, jadi simpan ke folder slug dengan nama index.md
            const folderPath = path.join('content/posts', post.slug);
            const filePath = path.join(folderPath, 'index.md'); 

            // Periksa apakah file sudah ada
            if (await fs.pathExists(filePath)) {
                console.log(`Skipping post: ${post.slug}`);
                return; // Lewati post ini
            }

            try {
                await fs.mkdir(folderPath, { recursive: true });
                await fs.writeFile(filePath, fileString, { flag: 'w' });
            } catch (error) {
                console.error('Error:', error);
            }

            // download cover image, masukkan sesuai pagebudle
            await downloadImage(post.feature_image, `${folderPath}/cover.webp`, 'webp');
        }));

    console.timeEnd('All posts converted to Markdown in');

    } catch (error) {
        console.error(error);
    }
};

// atur config.yml otomatis. Harus disesuaikan dengan tema papermodX
const siteConfig = async () => {
    console.log('Setting up site config...')
    const config = yaml.load(fs.readFileSync('config.yml', 'utf8'));
    const settings = await api.settings.browse();
    config.title = settings.title;
    config.timeZone  = settings.timezone;
    config.params.title = settings.title;
    config.params.description = settings.description;
    // download gambar untuk opengraph, sepertinya sih dari cover_image
    // downloadImage(settings.cover_image, 'static/cover.webp', 'webp');
    // config.params.images = '/cover.webp';
    // favicon
    downloadImage(settings.icon, 'static/favicon.png', 'png', 60);
    config.params.favicon = '/favicon.png';
    config.params.appleTouchIcon = '/favicon.png';

    fs.writeFileSync('config.yml', yaml.dump(config));
}

// keperluan dev, hapus folder
const checkFolder = () => {
    if (!fs.existsSync("content/posts")) {
        fs.mkdirSync("content/posts");
    } else {
        fs.rm('content/posts', { recursive: true });
    }
}

// download gamber dan convert ke format yg diinginkan
async function downloadImage(url, filename, format, resize) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const image = await sharp(response.data).toFormat(format);
  if(resize) {
    image.resize(width=resize);
  }
  await image.toFile(filename);
}

// command untuk dipakai di package.json
switch (process.argv[2]) {
    case 'dev':
        checkFolder();
        generateContent();
        break;
    case 'prod':
        siteConfig();
        generateContent();
        break;
    case 'test':
        siteConfig();
        break;
}