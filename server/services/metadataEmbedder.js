/**
 * Metadata Embedder Service
 *
 * Embeds audiobook metadata into audio files using tone (M4B/M4A)
 * or ffmpeg (MP3, FLAC, OGG, etc.).
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Embed metadata into M4B/M4A files using tone CLI.
 * @param {Object} audiobook - Audiobook record from database
 * @param {Array} chapters - Chapter records from database
 * @param {string|null} coverFile - Path to cover image file
 * @returns {Promise<{message: string}>} Result with status message
 */
async function embedWithTone(audiobook, chapters, coverFile) {
  const dir = path.dirname(audiobook.file_path);
  const metadataJsonFile = path.join(dir, `metadata_${audiobook.id}.json`);

  try {
    // Build metadata object for tone
    const toneMetadata = {
      meta: {}
    };

    // Basic metadata
    if (audiobook.title) {
      toneMetadata.meta.title = audiobook.title;
      toneMetadata.meta.sortTitle = audiobook.title.replace(/^(The|A|An)\s+/i, '');
    }
    if (audiobook.subtitle) toneMetadata.meta.subtitle = audiobook.subtitle;
    if (audiobook.author) {
      toneMetadata.meta.artist = audiobook.author;
      toneMetadata.meta.albumArtist = audiobook.author;
      // Sort by last name if comma-separated, otherwise use as-is
      const authorParts = audiobook.author.split(',');
      toneMetadata.meta.sortArtist = authorParts.length > 1 ? audiobook.author : audiobook.author;
      toneMetadata.meta.sortAlbumArtist = toneMetadata.meta.sortArtist;
    }
    if (audiobook.narrator) {
      toneMetadata.meta.narrator = audiobook.narrator;
      toneMetadata.meta.composer = audiobook.narrator;
      toneMetadata.meta.sortComposer = audiobook.narrator;
    }
    if (audiobook.description) {
      toneMetadata.meta.description = audiobook.description;
      // Use longDescription for full text if description is long
      if (audiobook.description.length > 255) {
        toneMetadata.meta.longDescription = audiobook.description;
      }
    }
    if (audiobook.genre) toneMetadata.meta.genre = audiobook.genre;
    // publishingDate needs full ISO date format, not just year
    if (audiobook.published_year) {
      toneMetadata.meta.publishingDate = `${audiobook.published_year}-01-01`;
    }
    if (audiobook.publisher) toneMetadata.meta.publisher = audiobook.publisher;
    if (audiobook.copyright_year) toneMetadata.meta.copyright = String(audiobook.copyright_year);

    // Set iTunes media type to Audiobook
    toneMetadata.meta.itunesMediaType = 'Audiobook';

    // Tags/grouping
    if (audiobook.tags) toneMetadata.meta.group = audiobook.tags;

    // Series info - use movement tags (proper audiobook series tags)
    // Always set album explicitly to prevent stale tags from causing series/title swaps on re-scan
    if (audiobook.series) {
      toneMetadata.meta.movementName = audiobook.series;
      toneMetadata.meta.album = audiobook.series;
      toneMetadata.meta.sortAlbum = audiobook.series;
      if (audiobook.series_position) {
        // movement is a string in tone's JSON format
        toneMetadata.meta.movement = String(audiobook.series_position);
        toneMetadata.meta.part = String(audiobook.series_position);
      }
    } else {
      // No series — set album to title so old series data in album tag doesn't persist
      if (audiobook.title) {
        toneMetadata.meta.album = audiobook.title;
        toneMetadata.meta.sortAlbum = audiobook.title.replace(/^(The|A|An)\s+/i, '');
      }
      // Clear movement tags so stale series info doesn't linger
      toneMetadata.meta.movementName = '';
      toneMetadata.meta.movement = '';
    }

    // Embed cover art if available
    if (coverFile) {
      try {
        const coverData = fs.readFileSync(coverFile);
        const base64Cover = coverData.toString('base64');
        const coverExt = path.extname(coverFile).toLowerCase();
        const mimetype = coverExt === '.png' ? 'image/png' : 'image/jpeg';

        toneMetadata.meta.embeddedPictures = [{
          type: 2,  // Front cover
          code: 3,  // Front cover code
          mimetype: mimetype,
          data: base64Cover
        }];
        console.log(`Including cover art from ${coverFile}`);
      } catch (coverErr) {
        console.log(`Could not read cover art: ${coverErr.message}`);
      }
    }

    // Additional fields for ASIN, ISBN, language, rating, abridged
    const hasAdditionalFields = audiobook.asin || audiobook.isbn || audiobook.language || audiobook.rating || audiobook.abridged;
    if (hasAdditionalFields) {
      toneMetadata.meta.additionalFields = {};
      if (audiobook.asin) toneMetadata.meta.additionalFields.ASIN = audiobook.asin;
      if (audiobook.isbn) toneMetadata.meta.additionalFields.ISBN = audiobook.isbn;
      if (audiobook.language) toneMetadata.meta.additionalFields.LANGUAGE = audiobook.language;
      if (audiobook.rating) toneMetadata.meta.additionalFields.RATING = audiobook.rating;
      if (audiobook.abridged) toneMetadata.meta.additionalFields.ABRIDGED = audiobook.abridged ? 'Yes' : 'No';
    }

    // Add chapters if we have them
    if (chapters.length > 0) {
      toneMetadata.meta.chapters = chapters.map(chapter => ({
        start: Math.floor((chapter.start_time || 0) * 1000),  // milliseconds
        length: Math.floor((chapter.duration || 0) * 1000),
        title: chapter.title || `Chapter ${chapter.chapter_number}`
      }));
    }

    // Write JSON file
    const jsonContent = JSON.stringify(toneMetadata, null, 2);
    fs.writeFileSync(metadataJsonFile, jsonContent, 'utf8');
    console.log(`Created tone metadata JSON file with ${chapters.length} chapters`);
    console.log(`Tone metadata JSON (without cover data): ${JSON.stringify({
      ...toneMetadata,
      meta: {
        ...toneMetadata.meta,
        embeddedPictures: toneMetadata.meta.embeddedPictures ? '[cover data omitted]' : undefined
      }
    }, null, 2)}`);

    // Build tone command with JSON file
    const args = ['tag', audiobook.file_path, `--meta-tone-json-file=${metadataJsonFile}`];

    console.log(`Embedding metadata with tone into ${audiobook.file_path}${chapters.length > 0 ? ` with ${chapters.length} chapters` : ''}`);

    // Run tone
    try {
      const result = await execFileAsync('tone', args, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
      console.log('Tone output:', result.stdout);

      // Tone prints errors to stdout and exits with code 0, so we need to check the output
      if (result.stdout && result.stdout.includes('Could not')) {
        console.error('Tone reported an error:', result.stdout);
        throw new Error(`Tone failed: ${result.stdout}`);
      }
    } catch (toneError) {
      console.error('Tone stderr:', toneError.stderr);
      console.error('Tone stdout:', toneError.stdout);
      throw new Error(`Tone failed: ${toneError.stderr || toneError.stdout || toneError.message}`);
    }

    console.log(`Successfully embedded metadata into ${audiobook.file_path}`);
    return {
      message: `Metadata embedded successfully with tone${chapters.length > 0 ? ` (${chapters.length} chapters)` : ''}`
    };
  } finally {
    // Clean up JSON file
    if (fs.existsSync(metadataJsonFile)) {
      fs.unlinkSync(metadataJsonFile);
    }
  }
}

/**
 * Embed metadata into MP3/FLAC/OGG files using ffmpeg.
 * @param {Object} audiobook - Audiobook record from database
 * @param {Array} chapters - Chapter records from database (unused for ffmpeg)
 * @param {string|null} coverFile - Path to cover image file
 * @returns {Promise<{message: string}>} Result with status message
 */
async function embedWithFfmpeg(audiobook, chapters, coverFile) {
  const ext = path.extname(audiobook.file_path).toLowerCase();
  const tempPath = audiobook.file_path + '.tmp' + ext;

  try {
    const isMP3 = ext === '.mp3';
    const isFlac = ext === '.flac';
    const isVorbis = ext === '.flac' || ext === '.ogg' || ext === '.opus';

    const args = ['-i', audiobook.file_path];

    // Add cover image as second input if available (MP3 and FLAC supported)
    const hasCover = coverFile && (isMP3 || isFlac);
    if (hasCover) {
      args.push('-i', coverFile);
    }

    // Preserve existing metadata and merge with new values
    args.push('-map_metadata', '0');

    // Basic metadata
    if (audiobook.title) args.push('-metadata', `title=${audiobook.title}`);
    if (audiobook.author) {
      args.push('-metadata', `artist=${audiobook.author}`);
      args.push('-metadata', `album_artist=${audiobook.author}`);
    }
    if (audiobook.narrator) {
      args.push('-metadata', `composer=${audiobook.narrator}`);
      // For Vorbis (FLAC/OGG), write explicit NARRATOR tag
      if (isVorbis) args.push('-metadata', `NARRATOR=${audiobook.narrator}`);
    }
    if (audiobook.description) args.push('-metadata', `description=${audiobook.description}`);
    if (audiobook.genre) args.push('-metadata', `genre=${audiobook.genre}`);
    if (audiobook.published_year) args.push('-metadata', `date=${audiobook.published_year}`);
    if (audiobook.subtitle) args.push('-metadata', `subtitle=${audiobook.subtitle}`);

    // Series info — write format-appropriate tags for proper round-trip
    // Always set album explicitly to prevent stale tags from causing series/title swaps on re-scan
    if (audiobook.series) {
      args.push('-metadata', `album=${audiobook.series}`);
      const seriesWithPosition = audiobook.series_position
        ? `${audiobook.series} #${audiobook.series_position}`
        : audiobook.series;
      args.push('-metadata', `grouping=${seriesWithPosition}`);
      if (audiobook.series_position) {
        args.push('-metadata', `disc=${audiobook.series_position}`);
      }
      // For Vorbis (FLAC/OGG), write explicit SERIES and PART tags
      if (isVorbis) {
        args.push('-metadata', `SERIES=${audiobook.series}`);
        if (audiobook.series_position) {
          args.push('-metadata', `PART=${audiobook.series_position}`);
        }
      }
    } else {
      // No series — set album to title so old series data doesn't persist
      if (audiobook.title) args.push('-metadata', `album=${audiobook.title}`);
      // Clear grouping so stale series info doesn't linger
      args.push('-metadata', 'grouping=');
      if (isVorbis) {
        args.push('-metadata', 'SERIES=');
        args.push('-metadata', 'PART=');
      }
    }

    // Additional metadata fields
    if (audiobook.publisher) args.push('-metadata', `publisher=${audiobook.publisher}`);
    if (audiobook.copyright_year) args.push('-metadata', `copyright=${audiobook.copyright_year}`);
    if (audiobook.isbn) args.push('-metadata', `ISBN=${audiobook.isbn}`);
    if (audiobook.asin) args.push('-metadata', `ASIN=${audiobook.asin}`);
    if (audiobook.language) args.push('-metadata', `language=${audiobook.language}`);

    // Map streams and set codecs
    if (hasCover) {
      // Map audio from first input and cover image from second input
      args.push('-map', '0:a');
      args.push('-map', '1:v');
      args.push('-c:a', 'copy');
      args.push('-c:v', 'copy');
      if (isMP3) {
        // ID3v2 tag version (required for embedded pictures in MP3)
        args.push('-id3v2_version', '3');
        // Mark the image as front cover
        args.push('-metadata:s:v', 'title=Album cover');
        args.push('-metadata:s:v', 'comment=Cover (front)');
      } else if (isFlac) {
        // FLAC uses METADATA_BLOCK_PICTURE for embedded cover art
        args.push('-disposition:v', 'attached_pic');
      }
      console.log(`Including cover art from ${coverFile}`);
    } else {
      // No cover - just copy all streams
      args.push('-c', 'copy');
    }

    args.push('-y', tempPath);

    console.log(`Embedding metadata with ffmpeg into ${audiobook.file_path}${hasCover ? ' (with cover)' : ''}`);

    try {
      await execFileAsync('ffmpeg', args, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
    } catch (ffmpegError) {
      console.error('FFmpeg stderr:', ffmpegError.stderr);
      throw new Error(`FFmpeg failed: ${ffmpegError.stderr || ffmpegError.message}`);
    }

    // Replace original with temp file
    fs.renameSync(tempPath, audiobook.file_path);

    console.log(`Successfully embedded metadata into ${audiobook.file_path}`);
    return {
      message: `Metadata embedded successfully with ffmpeg${hasCover ? ' (with cover)' : ''}`
    };
  } catch (error) {
    // Clean up temp file on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

module.exports = { embedWithTone, embedWithFfmpeg };
