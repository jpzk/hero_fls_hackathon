# AI approach

We have used Claude Code Opus 4.6 mostly for both part of the architecture (data pipeline and consumer application). For both sides we tried to have self-improving loops where the agent has a view into the output and can re-iterate with minimal HITL. 

For the processing pipeline we used 1080p landscape footage 10s with 10 FPS, 100 frames with COLMAP as Structure from Motion to convert the images to point clouds. We then used 3DGS reference algorithm for converting the point cloud to gaussian splats estimates. We ran COLMAP and GPU-accelerated 3DGS on a RunPod instance with a RTX5090. We have learned a ton of lessons regarding infrastructure on RunPod and where the limits with pixels only are.

For the frontend we few shotted a gaussian splat viewer to have full control over the UX. The consumer application and pitch deck were also done with Opus. 

 
