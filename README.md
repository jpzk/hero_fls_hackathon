# Hero FLS AI Hackathon submission

**Company:** https://hero-software.de/

**Team:** Ipad Builders

## Architecture & AI approach

We have used Claude Code Opus 4.6 mostly for both part of the architecture (data pipeline and consumer application). For both sides we tried to have self-improving loops where the agent has a view into the output and can re-iterate with minimal HITL. 

For the processing pipeline we used 1080p landscape footage 10s with 10 FPS, 100 frames with COLMAP as Structure from Motion to convert the images to point clouds. We then used GPU-accelerated 3DGS algorithm for converting the point cloud to gaussian splats estimates. We run the pipeline on RunPod instance with a RTX5090. We have learned a ton of lessons regarding infrastructure on RunPod and where the limits with pixels only are.

For the frontend we few shotted a gaussian splat viewer to have full control over the UX. For analytics on the job we have used 2D image classification using a multi modal Gemini. The consumer application and pitch deck were also done with Opus.

## Outcome

![view](https://github.com/user-attachments/assets/0896f0c9-8164-4adb-9235-7c9a8d224814)
