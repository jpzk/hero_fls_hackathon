# 3D Gaussian Splatting pipeline: video → .splat
# Usage:
#   make splat                                    # use default video
#   make splat VIDEO_URL=https://example.com/v.MOV  # download video first
#   make splat FPS=2                              # override frame rate
#   make splat ITERATIONS=7000                    # override training iterations

GS          := 3dgs
VIDEO_URL   ?=
VIDEO       ?= $(GS)/input/IMG_7249.MOV
ITERATIONS  := 30000
FPS         := 6
TIMESTAMP   := $(shell date +%H%M)

# Derive scene/model names from video filename
VIDEO_NAME  := $(basename $(notdir $(VIDEO)))
SCENE       := $(GS)/data/$(VIDEO_NAME)
MODEL       := $(GS)/output/$(VIDEO_NAME)

# CUDA + headless COLMAP + workspace Python libs
export PATH := /usr/local/cuda/bin:$(PATH)
export QT_QPA_PLATFORM := offscreen
export PYTHONPATH := /workspace/libs:$(PYTHONPATH)

# Derived paths
FRAMES_DIR  := $(SCENE)/input
SPARSE_DIR  := $(SCENE)/sparse/0
PLY         := $(MODEL)/point_cloud/iteration_$(ITERATIONS)/point_cloud.ply
SPLAT_OUT   := $(GS)/output/output_$(TIMESTAMP).splat
PLY_OUT     := $(GS)/output/output_$(TIMESTAMP).ply

VIEWER_DIR  := viewer_overlays
VIEWER_PID  := /tmp/viewer.pid

.PHONY: help splat clean deps viewer viewer-stop

help: ## Show this help
	@echo "Usage: make <target> [PARAM=value ...]"
	@echo ""
	@echo "Targets:"
	@echo "  splat          Run full pipeline: video -> frames -> COLMAP -> train -> .splat"
	@echo "  deps           Install CUDA submodules (diff-rasterization, simple-knn, fused-ssim)"
	@echo "  viewer         Start the splat viewer server in the background"
	@echo "  viewer-stop    Stop the viewer server"
	@echo "  clean          Remove scene data and model output"
	@echo ""
	@echo "Parameters:"
	@echo "  VIDEO_URL      Download video from URL (default: use local file)"
	@echo "  FPS            Frame extraction rate (default: $(FPS))"
	@echo "  ITERATIONS     Training iterations (default: $(ITERATIONS))"
	@echo "  VIDEO          Path to input video (default: $(VIDEO))"

# Download video if VIDEO_URL is set
ifneq ($(VIDEO_URL),)
# Derive VIDEO from URL filename when VIDEO_URL is provided and VIDEO not explicitly set
ifeq ($(origin VIDEO),default)
override VIDEO := $(GS)/input/$(notdir $(VIDEO_URL))
VIDEO_NAME  := $(basename $(notdir $(VIDEO)))
SCENE       := $(GS)/data/$(VIDEO_NAME)
MODEL       := $(GS)/output/$(VIDEO_NAME)
endif
$(VIDEO):
	mkdir -p $(dir $(VIDEO))
	curl -L -o $(VIDEO) "$(VIDEO_URL)"
endif

# Full pipeline
splat: $(PLY)
	cp $(PLY) $(PLY_OUT)
	cd $(GS) && python ply_to_splat.py $(abspath $(PLY)) $(abspath $(SPLAT_OUT))
	@echo "Done: $(SPLAT_OUT) + $(PLY_OUT)"

# Install CUDA submodules if needed
deps:
	cd $(GS) && pip install --break-system-packages --no-build-isolation submodules/diff-gaussian-rasterization
	cd $(GS) && pip install --break-system-packages --no-build-isolation submodules/simple-knn
	cd $(GS) && pip install --break-system-packages --no-build-isolation submodules/fused-ssim

# Step 1: Extract frames from video
$(FRAMES_DIR): $(VIDEO)
	mkdir -p $(FRAMES_DIR)
	ffmpeg -i $(VIDEO) -qscale:v 1 -qmin 1 -vf "fps=$(FPS),scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(ih,iw),min(1080,ih),-2)'" $(FRAMES_DIR)/%04d.jpg
	@echo "Extracted $$(ls $(FRAMES_DIR)/*.jpg | wc -l) frames at $(FPS) fps"

# Step 2: COLMAP — feature extraction, matching, reconstruction, undistortion
$(SPARSE_DIR): $(FRAMES_DIR)
	cd $(GS) && python convert.py -s $(abspath $(SCENE)) --camera OPENCV
	@echo "COLMAP reconstruction complete"

# Step 3: Train 3D Gaussian Splatting
$(PLY): $(SPARSE_DIR)
	cd $(GS) && python train.py \
		-s $(abspath $(SCENE)) \
		-m $(abspath $(MODEL)) \
		--iterations $(ITERATIONS) \
		--save_iterations $(ITERATIONS) \
		--disable_viewer
	@echo "Training complete — $(PLY)"

# Viewer server
viewer:
	@if [ -f $(VIEWER_PID) ] && kill -0 $$(cat $(VIEWER_PID)) 2>/dev/null; then \
		echo "Viewer already running (PID $$(cat $(VIEWER_PID)))"; \
	else \
		cd $(VIEWER_DIR) && nohup bun run src/dev.ts > /tmp/viewer.log 2>&1 & echo $$! > $(VIEWER_PID); \
		echo "Viewer started (PID $$(cat $(VIEWER_PID))), log: /tmp/viewer.log"; \
	fi

viewer-stop:
	@if [ -f $(VIEWER_PID) ] && kill -0 $$(cat $(VIEWER_PID)) 2>/dev/null; then \
		kill $$(cat $(VIEWER_PID)) && rm -f $(VIEWER_PID); \
		echo "Viewer stopped"; \
	else \
		echo "Viewer not running"; \
		rm -f $(VIEWER_PID); \
	fi

clean:
	rm -rf $(SCENE) $(MODEL)
