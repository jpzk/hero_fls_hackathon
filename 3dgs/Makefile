# 3D Gaussian Splatting pipeline: video → .splat
# Usage: make splat

VIDEO       := better_pov.MOV
SCENE       := data/better_pov
MODEL       := output/better_pov
ITERATIONS  := 30000
FPS         := 2

# Derived paths
FRAMES_DIR  := $(SCENE)/input
SPARSE_DIR  := $(SCENE)/sparse/0
PLY         := $(MODEL)/point_cloud/iteration_$(ITERATIONS)/point_cloud.ply
SPLAT       := output/better_pov.splat

.PHONY: splat clean deps

# Full pipeline
splat: $(SPLAT)

# Step 0: Install CUDA submodules if needed
deps:
	pip install submodules/diff-gaussian-rasterization
	pip install submodules/simple-knn
	pip install submodules/fused-ssim

# Step 1: Extract frames from video
$(FRAMES_DIR): $(VIDEO)
	mkdir -p $(FRAMES_DIR)
	ffmpeg -i $(VIDEO) -vf "fps=$(FPS)" -q:v 2 $(FRAMES_DIR)/frame_%04d.jpg
	@echo "Extracted $$(ls $(FRAMES_DIR)/*.jpg | wc -l) frames at $(FPS) fps"

# Step 2: COLMAP — feature extraction, matching, reconstruction, undistortion
$(SPARSE_DIR): $(FRAMES_DIR)
	python convert.py -s $(SCENE) --camera OPENCV
	@echo "COLMAP reconstruction complete"

# Step 3: Train 3D Gaussian Splatting
$(PLY): $(SPARSE_DIR)
	python train.py \
		-s $(SCENE) \
		-m $(MODEL) \
		--iterations $(ITERATIONS) \
		--save_iterations $(ITERATIONS) \
		--disable_viewer
	@echo "Training complete — $(PLY)"

# Step 4: Convert .ply to .splat
$(SPLAT): $(PLY)
	python ply_to_splat.py $(PLY) $(SPLAT)
	@echo "Done: $(SPLAT)"

clean:
	rm -rf $(SCENE) $(MODEL)
