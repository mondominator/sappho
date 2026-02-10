/**
 * Audiobook conversion route handlers
 * Handles M4B conversion jobs: start, status, list, cancel
 */
const { jobStatusLimiter, jobCancelLimiter } = require('./helpers');
const { createQueryHelpers } = require('../../utils/queryHelpers');

function register(router, { db, authenticateToken, requireAdmin, conversionService }) {
  const { getAudiobookById } = createQueryHelpers(db);

  // Convert audiobook to M4B format (admin only) - async with progress tracking
  router.post('/:id/convert-to-m4b', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const audiobook = await getAudiobookById(req.params.id);

      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Start async conversion - returns immediately with job ID
      const result = await conversionService.startConversion(audiobook, db);

      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        message: 'Conversion started',
        jobId: result.jobId,
        status: result.status
      });

    } catch (error) {
      console.error('Error starting conversion:', error);
      res.status(500).json({ error: 'Failed to start conversion' });
    }
  });

  // Get conversion job status (admin only)
  router.get('/jobs/conversion/:jobId', jobStatusLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const job = conversionService.getJobStatus(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  });

  // Get all active conversion jobs (admin only)
  router.get('/jobs/conversion', jobStatusLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const jobs = conversionService.getActiveJobs();
    res.json({ jobs });
  });

  // Cancel a conversion job (admin only)
  router.delete('/jobs/conversion/:jobId', jobCancelLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const result = conversionService.cancelJob(req.params.jobId);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'Job cancelled' });
  });

  // Get active conversion job for a specific audiobook (admin only)
  router.get('/:id/conversion-status', jobStatusLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const audiobookId = parseInt(req.params.id, 10);
    const job = conversionService.getActiveJobForAudiobook(audiobookId);

    if (!job) {
      return res.json({ active: false });
    }

    res.json({ active: true, job });
  });
}

module.exports = { register };
